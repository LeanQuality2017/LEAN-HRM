import { Prisma } from '@prisma/client'
import { TDS_CONFIG, TaxSlab } from './statutory-config'
import { toDecimal, round, add, sub, mul, div, min, max, ZERO } from './money'

/**
 * Section 288A & 288B Rounding:
 * Taxable income and total tax liability must be rounded off to the nearest ten rupees.
 * If the last digit is 5 or more, round up; otherwise round down.
 * Implemented using strict Decimal arithmetic with ZERO float/Number conversion.
 */
export function roundToNearest10(amount: Prisma.Decimal): Prisma.Decimal {
  const ten = new Prisma.Decimal('10')
  return amount.dividedBy(ten).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).times(ten)
}

export type TaxRegime = 'NEW' | 'OLD'
export type FinancialYear = 'FY2026_27' | 'FY2025_26' | 'FY2024_25' | 'FY2023_24'

/**
 * Resolves Indian Financial Year (April 1 to March 31).
 * Supports both signatures: (month, year) or (year, month).
 * Throws an explicit error if the financial year is unconfigured (no silent fallback).
 */
export function resolveFinancialYear(param1: number, param2: number): FinancialYear {
  let month: number
  let year: number

  if (param1 > 100) {
    year = param1
    month = param2
  } else {
    month = param1
    year = param2
  }

  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}. Month must be between 1 and 12.`)
  }

  const startYear = month >= 4 ? year : year - 1
  const endYearShort = (startYear + 1) % 100
  const fyKey = `FY${startYear}_${endYearShort.toString().padStart(2, '0')}` as FinancialYear

  if (!TDS_CONFIG.NEW_REGIME[fyKey as keyof typeof TDS_CONFIG.NEW_REGIME]) {
    throw new Error(`Tax configuration not found for financial year: ${fyKey}`)
  }

  return fyKey
}

export interface DeclaredDeductionsInput {
  section80C?: Prisma.Decimal | number | string | null
  section80D?: Prisma.Decimal | number | string | null
  otherChapter6A?: Prisma.Decimal | number | string | null
}

export interface AnnualTaxCalculationInput {
  regime: string
  grossAnnualSalary: Prisma.Decimal | number | string
  declaredDeductions?: DeclaredDeductionsInput | null
  financialYear?: FinancialYear
}

export interface AnnualTaxResult {
  regime: TaxRegime
  financialYear: FinancialYear
  grossSalary: Prisma.Decimal
  standardDeduction: Prisma.Decimal
  chapter6ADeductions: Prisma.Decimal
  taxableIncome: Prisma.Decimal
  baseTax: Prisma.Decimal
  rebate87A: Prisma.Decimal
  marginalRelief: Prisma.Decimal
  taxAfterRebate: Prisma.Decimal
  surcharge: Prisma.Decimal
  cess: Prisma.Decimal
  totalTax: Prisma.Decimal
}

export interface MonthlyTdsInput {
  regime: string
  grossAnnualSalary: Prisma.Decimal | number | string
  declaredDeductions?: DeclaredDeductionsInput | null
  financialYear?: FinancialYear
  currentMonth?: number // 1 to 12
  remainingMonthsInFY?: number // 1 to 12
  previousTdsDeducted?: Prisma.Decimal | number | string | null
}

export interface MonthlyTdsResult {
  annualResult: AnnualTaxResult
  previousTdsDeducted: Prisma.Decimal
  remainingTaxLiability: Prisma.Decimal
  remainingMonthsInFY: number
  monthlyTds: Prisma.Decimal
}

/**
 * Computes progressive tax through graduated tax slabs.
 */
function computeSlabTax(taxableIncome: Prisma.Decimal, slabs: TaxSlab[]): Prisma.Decimal {
  let tax = ZERO
  for (const slab of slabs) {
    if (taxableIncome.greaterThan(slab.min)) {
      const upper = slab.max ? min(taxableIncome, slab.max) : taxableIncome
      const taxableInSlab = sub(upper, slab.min)
      const slabTax = mul(taxableInSlab, slab.rate)
      tax = add(tax, slabTax)
    }
  }
  return round(tax, 2)
}

/**
 * Pure calculation engine for Section 192 Annual Salary Income Tax.
 * Throws explicit error if regime is missing or invalid.
 */
export function calculateAnnualTax(input: AnnualTaxCalculationInput): AnnualTaxResult {
  if (!input || !input.regime || typeof input.regime !== 'string' || input.regime.trim() === '') {
    throw new Error('TDS not configured')
  }

  const normalizedRegime = input.regime.trim().toUpperCase() as TaxRegime
  if (normalizedRegime !== 'NEW' && normalizedRegime !== 'OLD') {
    throw new Error(`Unsupported TDS regime: ${input.regime}. Allowed: 'NEW', 'OLD'.`)
  }

  const fy: FinancialYear = input.financialYear || 'FY2024_25'
  const gross = max(ZERO, toDecimal(input.grossAnnualSalary))

  if (gross.isZero()) {
    return {
      regime: normalizedRegime,
      financialYear: fy,
      grossSalary: ZERO,
      standardDeduction: ZERO,
      chapter6ADeductions: ZERO,
      taxableIncome: ZERO,
      baseTax: ZERO,
      rebate87A: ZERO,
      marginalRelief: ZERO,
      taxAfterRebate: ZERO,
      surcharge: ZERO,
      cess: ZERO,
      totalTax: ZERO,
    }
  }

  let standardDeduction: Prisma.Decimal
  let slabs: TaxSlab[]
  let rebateThreshold: Prisma.Decimal
  let maxRebate: Prisma.Decimal
  let chapter6ADeductions = ZERO

  if (normalizedRegime === 'NEW') {
    const config = TDS_CONFIG.NEW_REGIME[fy as keyof typeof TDS_CONFIG.NEW_REGIME]
    if (!config) {
      throw new Error(`Tax configuration not found for financial year: ${fy}`)
    }
    standardDeduction = min(gross, config.standardDeduction.value)
    slabs = config.slabs
    rebateThreshold = config.rebate87AThreshold.value
    maxRebate = config.rebate87AMax.value
    // New regime under Section 115BAC disallows Chapter VI-A deductions
    chapter6ADeductions = ZERO
  } else {
    const config = TDS_CONFIG.OLD_REGIME
    standardDeduction = min(gross, config.standardDeduction.value)
    slabs = config.slabs
    rebateThreshold = config.rebate87AThreshold.value
    maxRebate = config.rebate87AMax.value

    // Chapter VI-A Deductions
    const dec = input.declaredDeductions
    if (dec) {
      const d80C = dec.section80C ? min(max(ZERO, toDecimal(dec.section80C)), config.chapter6ACap80C.value) : ZERO
      const d80D = dec.section80D ? max(ZERO, toDecimal(dec.section80D)) : ZERO
      const dOther = dec.otherChapter6A ? max(ZERO, toDecimal(dec.otherChapter6A)) : ZERO
      chapter6ADeductions = add(add(d80C, d80D), dOther)
    }
  }

  // Gross Total Income after Standard Deduction
  const grossTotalIncome = max(ZERO, sub(gross, standardDeduction))

  // Net Taxable Income
  let rawTaxable = max(ZERO, sub(grossTotalIncome, chapter6ADeductions))
  const taxableIncome = roundToNearest10(rawTaxable)

  // Slabs Tax
  const baseTax = computeSlabTax(taxableIncome, slabs)

  // Rebate u/s 87A and Marginal Relief
  let rebate87A = ZERO
  let marginalRelief = ZERO
  let taxAfterRebate = baseTax

  if (normalizedRegime === 'NEW') {
    if (taxableIncome.lessThanOrEqualTo(rebateThreshold)) {
      // Full rebate up to max
      rebate87A = min(baseTax, maxRebate)
      taxAfterRebate = max(ZERO, sub(baseTax, rebate87A))
    } else {
      // Marginal Relief under proviso to Section 87A:
      // Tax payable cannot exceed the income exceeding the applicable rebate threshold (e.g. ₹12,00,000 for FY25-26/FY26-27, ₹7,00,000 for FY24-25)
      const excessIncome = sub(taxableIncome, rebateThreshold)
      if (baseTax.greaterThan(excessIncome)) {
        marginalRelief = sub(baseTax, excessIncome)
        rebate87A = marginalRelief
        taxAfterRebate = excessIncome
      }
    }
  } else {
    // Old Regime
    if (taxableIncome.lessThanOrEqualTo(rebateThreshold)) {
      rebate87A = min(baseTax, maxRebate)
      taxAfterRebate = max(ZERO, sub(baseTax, rebate87A))
    }
  }

  // Surcharge (regime-aware, sorted descending so higher brackets match first)
  let surcharge = ZERO
  if (taxAfterRebate.greaterThan(ZERO)) {
    const surchargeSlabs = normalizedRegime === 'NEW'
      ? TDS_CONFIG.SURCHARGE_SLABS.NEW_REGIME
      : TDS_CONFIG.SURCHARGE_SLABS.OLD_REGIME
    const sortedSurcharge = [...surchargeSlabs].sort((a, b) => (b.threshold.greaterThan(a.threshold) ? 1 : -1))
    for (const s of sortedSurcharge) {
      if (taxableIncome.greaterThan(s.threshold)) {
        surcharge = round(mul(taxAfterRebate, s.rate), 2)
        break
      }
    }
  }

  // Health and Education Cess (4%)
  const taxPlusSurcharge = add(taxAfterRebate, surcharge)
  const cess = taxPlusSurcharge.greaterThan(ZERO)
    ? round(mul(taxPlusSurcharge, TDS_CONFIG.CESS_RATE.value), 2)
    : ZERO

  // Total Annual Tax Liability (rounded to nearest 10 per Section 288B)
  const rawTotalTax = add(taxPlusSurcharge, cess)
  const totalTax = roundToNearest10(rawTotalTax)

  return {
    regime: normalizedRegime,
    financialYear: fy,
    grossSalary: gross,
    standardDeduction,
    chapter6ADeductions,
    taxableIncome,
    baseTax,
    rebate87A,
    marginalRelief,
    taxAfterRebate,
    surcharge,
    cess,
    totalTax,
  }
}

/**
 * Computes monthly Section 192 TDS deduction by spreading the remaining annual liability
 * over remaining months in the financial year.
 */
export function calculateMonthlyTds(input: MonthlyTdsInput): MonthlyTdsResult {
  const annualResult = calculateAnnualTax({
    regime: input.regime,
    grossAnnualSalary: input.grossAnnualSalary,
    declaredDeductions: input.declaredDeductions,
    financialYear: input.financialYear,
  })

  const previousDeducted = max(ZERO, toDecimal(input.previousTdsDeducted ?? ZERO))
  const remainingLiability = max(ZERO, sub(annualResult.totalTax, previousDeducted))

  const remainingMonths = Math.max(1, Math.min(12, input.remainingMonthsInFY ?? 12))
  const monthlyTds = remainingLiability.isZero()
    ? ZERO
    : round(div(remainingLiability, new Prisma.Decimal(remainingMonths)), 2)

  return {
    annualResult,
    previousTdsDeducted: previousDeducted,
    remainingTaxLiability: remainingLiability,
    remainingMonthsInFY: remainingMonths,
    monthlyTds,
  }
}
