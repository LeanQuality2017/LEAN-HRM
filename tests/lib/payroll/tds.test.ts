import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  calculateAnnualTax,
  calculateMonthlyTds,
  roundToNearest10,
  resolveFinancialYear,
} from '@/lib/payroll/tds'
import { computePayslip, PayrollCalculationError } from '@/lib/payroll'

describe('Section H: Section 192 Salary TDS Engine (H1–H10)', () => {
  // H1: Missing/Invalid Regime Guard
  it('H1: throws "TDS not configured" when regime is missing, null, empty or invalid', () => {
    expect(() => calculateAnnualTax({ regime: '', grossAnnualSalary: '600000.00' })).toThrow(
      'TDS not configured'
    )
    expect(() => calculateAnnualTax({ regime: '   ', grossAnnualSalary: '600000.00' })).toThrow(
      'TDS not configured'
    )
    // @ts-expect-error test invalid regime input
    expect(() => calculateAnnualTax({ regime: null, grossAnnualSalary: '600000.00' })).toThrow(
      'TDS not configured'
    )
    expect(() => calculateAnnualTax({ regime: 'INVALID', grossAnnualSalary: '600000.00' })).toThrow(
      /Unsupported TDS regime/
    )
  })

  // H2: New Regime: Below Tax Slab Threshold
  it('H2: New Regime: Income below basic exemption threshold results in zero tax', () => {
    // Under FY 2024-25: Standard deduction is ₹75,000.
    // Gross ₹3,75,000 - ₹75,000 = ₹3,00,000 Taxable Income (within 0% slab)
    const result = calculateAnnualTax({
      regime: 'NEW',
      grossAnnualSalary: new Prisma.Decimal('375000.00'),
      financialYear: 'FY2024_25',
    })

    expect(result.grossSalary.toFixed(2)).toBe('375000.00')
    expect(result.standardDeduction.toFixed(2)).toBe('75000.00')
    expect(result.taxableIncome.toFixed(2)).toBe('300000.00')
    expect(result.baseTax.toFixed(2)).toBe('0.00')
    expect(result.totalTax.toFixed(2)).toBe('0.00')
  })

  // H3: New Regime: Section 87A Full Rebate up to ₹7,00,000
  it('H3: New Regime: Taxable income <= ₹7,00,000 receives 100% Section 87A rebate resulting in zero tax', () => {
    // Gross ₹7,75,000 - ₹75,000 std deduction = ₹7,00,000 Taxable Income
    // Slabs: 0-3L @ 0% = 0, 3L-7L @ 5% = ₹20,000
    // Section 87A rebate = ₹20,000 -> Total Tax = 0
    const result = calculateAnnualTax({
      regime: 'NEW',
      grossAnnualSalary: new Prisma.Decimal('775000.00'),
      financialYear: 'FY2024_25',
    })

    expect(result.taxableIncome.toFixed(2)).toBe('700000.00')
    expect(result.baseTax.toFixed(2)).toBe('20000.00')
    expect(result.rebate87A.toFixed(2)).toBe('20000.00')
    expect(result.taxAfterRebate.toFixed(2)).toBe('0.00')
    expect(result.totalTax.toFixed(2)).toBe('0.00')
  })

  // H4: New Regime: Section 87A Marginal Relief Proviso
  it('H4: New Regime: Marginal Relief u/s 87A proviso caps tax at excess income over ₹7,00,000', () => {
    // Test FY 2023-24 slabs for exact benchmark:
    // Slabs: 0-3L 0%, 3L-6L 5% (15k), 6L-9L 10%
    // Taxable Income: ₹7,05,000 (after ₹50k std deduction from ₹7,55,000 gross)
    // Base Tax without relief: 15,000 + 10% of 1,05,000 = 15,000 + 10,500 = ₹25,500
    // Excess income over ₹7,00,000 = ₹7,05,000 - ₹7,00,000 = ₹5,000
    // Marginal relief = ₹25,500 - ₹5,000 = ₹20,500
    // Tax after relief = ₹5,000 + 4% cess (₹200) = ₹5,200
    const result = calculateAnnualTax({
      regime: 'NEW',
      grossAnnualSalary: new Prisma.Decimal('755000.00'),
      financialYear: 'FY2023_24',
    })

    expect(result.taxableIncome.toFixed(2)).toBe('705000.00')
    expect(result.baseTax.toFixed(2)).toBe('25500.00')
    expect(result.marginalRelief.toFixed(2)).toBe('20500.00')
    expect(result.taxAfterRebate.toFixed(2)).toBe('5000.00')
    expect(result.cess.toFixed(2)).toBe('200.00')
    expect(result.totalTax.toFixed(2)).toBe('5200.00')
  })

  // H5: New Regime: Higher Progressive Slabs Above Marginal Relief
  it('H5: New Regime: Computes progressive slab tax correctly for high income above marginal relief with 4% cess', () => {
    // FY 2024-25: Gross ₹10,75,000 - ₹75,000 std deduction = ₹10,00,000 Taxable
    // Slabs:
    // 0 to 3L: 0% = 0
    // 3L to 7L (4L): 5% = ₹20,000
    // 7L to 10L (3L): 10% = ₹30,000
    // Base Tax = ₹50,000
    // Cess 4% = ₹2,000
    // Total Tax = ₹52,000
    const result = calculateAnnualTax({
      regime: 'NEW',
      grossAnnualSalary: new Prisma.Decimal('1075000.00'),
      financialYear: 'FY2024_25',
    })

    expect(result.taxableIncome.toFixed(2)).toBe('1000000.00')
    expect(result.baseTax.toFixed(2)).toBe('50000.00')
    expect(result.rebate87A.toFixed(2)).toBe('0.00')
    expect(result.cess.toFixed(2)).toBe('2000.00')
    expect(result.totalTax.toFixed(2)).toBe('52000.00')
  })

  // H6: Old Regime: Taxable Income <= ₹5,00,000 full 87A rebate
  it('H6: Old Regime: Taxable income <= ₹5,00,000 receives 100% Section 87A rebate resulting in zero tax', () => {
    // Gross ₹5,50,000 - ₹50,000 std deduction = ₹5,00,000 Taxable
    // Slabs: 0-2.5L @ 0% = 0, 2.5L-5L @ 5% = ₹12,500
    // Old Regime 87A rebate = ₹12,500 -> Total Tax = 0
    const result = calculateAnnualTax({
      regime: 'OLD',
      grossAnnualSalary: new Prisma.Decimal('550000.00'),
    })

    expect(result.taxableIncome.toFixed(2)).toBe('500000.00')
    expect(result.baseTax.toFixed(2)).toBe('12500.00')
    expect(result.rebate87A.toFixed(2)).toBe('12500.00')
    expect(result.taxAfterRebate.toFixed(2)).toBe('0.00')
    expect(result.totalTax.toFixed(2)).toBe('0.00')
  })

  // H7: Old Regime: Chapter VI-A Deductions
  it('H7: Old Regime: Deducts Section 80C and 80D from gross salary', () => {
    // Gross ₹8,00,000
    // Standard deduction = ₹50,000 -> Gross Total Income = ₹7,50,000
    // 80C = ₹1,50,000, 80D = ₹25,000 -> Total Chapter VI-A = ₹1,75,000
    // Taxable Income = ₹7,50,000 - ₹1,75,000 = ₹5,75,000
    const result = calculateAnnualTax({
      regime: 'OLD',
      grossAnnualSalary: new Prisma.Decimal('800000.00'),
      declaredDeductions: {
        section80C: new Prisma.Decimal('180000.00'), // Should cap at ₹1,50,000
        section80D: new Prisma.Decimal('25000.00'),
      },
    })

    expect(result.chapter6ADeductions.toFixed(2)).toBe('175000.00')
    expect(result.taxableIncome.toFixed(2)).toBe('575000.00')
  })

  // H8: Old Regime: Higher Slabs Calculation with 4% Cess
  it('H8: Old Regime: Computes slab tax correctly above ₹5,00,000 with 4% cess', () => {
    // Net Taxable Income: ₹8,00,000
    // Slabs:
    // 0 to 2.5L: 0% = 0
    // 2.5L to 5L (2.5L): 5% = ₹12,500
    // 5L to 8L (3L): 20% = ₹60,000
    // Base Tax = ₹72,500
    // Cess 4% = ₹2,900
    // Total Tax = ₹75,400
    const result = calculateAnnualTax({
      regime: 'OLD',
      grossAnnualSalary: new Prisma.Decimal('850000.00'), // Minus 50k std deduction = 800k
    })

    expect(result.taxableIncome.toFixed(2)).toBe('800000.00')
    expect(result.baseTax.toFixed(2)).toBe('72500.00')
    expect(result.cess.toFixed(2)).toBe('2900.00')
    expect(result.totalTax.toFixed(2)).toBe('75400.00')
  })

  // H9: Monthly TDS Spread Across Remaining Months
  it('H9: Spreads annual tax liability evenly across remaining months in financial year', () => {
    // Annual Tax Liability: ₹60,000
    // April (12 months remaining): ₹60,000 / 12 = ₹5,000/month
    const april = calculateMonthlyTds({
      regime: 'NEW',
      grossAnnualSalary: new Prisma.Decimal('1075000.00'), // ₹52,000 tax
      remainingMonthsInFY: 12,
      previousTdsDeducted: 0,
    })
    // ₹52,000 / 12 = 4333.33
    expect(april.monthlyTds.toFixed(2)).toBe('4333.33')

    // November (5 months remaining): ₹52,000 / 5 = ₹10,400/month
    const november = calculateMonthlyTds({
      regime: 'NEW',
      grossAnnualSalary: new Prisma.Decimal('1075000.00'),
      remainingMonthsInFY: 5,
      previousTdsDeducted: 0,
    })
    expect(november.monthlyTds.toFixed(2)).toBe('10400.00')
  })

  // H10: Mid-Year Re-spreading on Salary Revision or Previous Deductions
  it('H10: Correctly re-spreads remaining tax liability after mid-year deductions or revisions', () => {
    // Annual Tax Liability: ₹52,000
    // In November, ₹30,000 already deducted Apr-Oct
    // Remaining liability = ₹52,000 - ₹30,000 = ₹22,000
    // Remaining months = 5 (Nov, Dec, Jan, Feb, Mar)
    // Monthly deduction = ₹22,000 / 5 = ₹4,400.00
    const result = calculateMonthlyTds({
      regime: 'NEW',
      grossAnnualSalary: new Prisma.Decimal('1075000.00'),
      remainingMonthsInFY: 5,
      previousTdsDeducted: new Prisma.Decimal('30000.00'),
    })

    expect(result.remainingTaxLiability.toFixed(2)).toBe('22000.00')
    expect(result.remainingMonthsInFY).toBe(5)
    expect(result.monthlyTds.toFixed(2)).toBe('4400.00')
  })
})


describe('Section 192 TDS Comprehensive Verification (Audit Fixes)', () => {
  // 7.a: computePayslip integration with calculateMonthlyTds
  describe('7.a: Integration proof between computePayslip() and calculateMonthlyTds()', () => {
    it('computes identical monthly TDS in computePayslip() and calculateMonthlyTds() for ₹9,00,000 CTC in Nov 2026 (FY2026_27)', () => {
      // Annual gross: ₹9,00,000 (monthly gross ₹75,000).
      // In FY2026_27 (Nov 2026), standard deduction = ₹75,000 -> Taxable income = ₹8,25,000.
      // Under Finance Act 2025/2026 Section 87A rebate (threshold ₹12,00,000), taxable income <= ₹12L
      // receives full 87A rebate -> Total annual tax = 0 -> Monthly TDS = 0.
      const line = computePayslip({
        runId: 'run-nov-2026',
        month: 11,
        year: 2026,
        employee: {
          id: 'emp-9l',
          baseSalary: new Prisma.Decimal('75000.00'),
          statutoryProfile: {
            pfApplicable: false,
            esiApplicable: false,
            ptState: 'TN',
            tdsRegime: 'NEW',
          },
        },
        payRule: { workingDaysBasis: 'CALENDAR' },
        summary: { lopDays: 0, otHours: 0 },
      })

      const tdsStandalone = calculateMonthlyTds({
        regime: 'NEW',
        grossAnnualSalary: new Prisma.Decimal('900000.00'),
        financialYear: 'FY2026_27',
        remainingMonthsInFY: 5,
        previousTdsDeducted: 0,
      })

      expect(line.tds.toFixed(2)).toBe('0.00')
      expect(tdsStandalone.monthlyTds.toFixed(2)).toBe('0.00')
      expect(line.tds.toFixed(2)).toBe(tdsStandalone.monthlyTds.toFixed(2))
    })

    it('computes identical monthly TDS > 0 in computePayslip() and calculateMonthlyTds() for ₹15,00,000 CTC in Nov 2026 (FY2026_27)', () => {
      // Annual gross: ₹15,00,000 (monthly gross ₹1,25,000).
      // Standard deduction = ₹75,000 -> Taxable income = ₹14,25,000.
      // Slabs in FY2026_27:
      // 0-4L: 0% = 0
      // 4L-8L (4L): 5% = ₹20,000
      // 8L-12L (4L): 10% = ₹40,000
      // 12L-14.25L (2.25L): 15% = ₹33,750
      // Base Tax = ₹93,750
      // Cess 4% = ₹3,750
      // Total Tax = ₹97,500
      // In Nov (5 months remaining: Nov, Dec, Jan, Feb, Mar):
      // Monthly TDS = ₹97,500 / 5 = ₹19,500.00
      const line = computePayslip({
        runId: 'run-nov-2026-high',
        month: 11,
        year: 2026,
        employee: {
          id: 'emp-15l',
          baseSalary: new Prisma.Decimal('125000.00'),
          statutoryProfile: {
            pfApplicable: false,
            esiApplicable: false,
            ptState: 'TN',
            tdsRegime: 'NEW',
          },
        },
        payRule: { workingDaysBasis: 'CALENDAR' },
        summary: { lopDays: 0, otHours: 0 },
      })

      const tdsStandalone = calculateMonthlyTds({
        regime: 'NEW',
        grossAnnualSalary: new Prisma.Decimal('1500000.00'),
        financialYear: 'FY2026_27',
        remainingMonthsInFY: 5,
        previousTdsDeducted: 0,
      })

      expect(line.tds.greaterThan(new Prisma.Decimal("0.00"))).toBe(true)
      expect(line.tds.toFixed(2)).toBe('19500.00')
      expect(tdsStandalone.monthlyTds.toFixed(2)).toBe('19500.00')
      expect(line.tds.toFixed(2)).toBe(tdsStandalone.monthlyTds.toFixed(2))
    })

    it('computes identical monthly TDS > 0 in computePayslip() and calculateMonthlyTds() for ₹9,00,000 CTC in Nov 2024 (FY2024_25)', () => {
      // Annual gross: ₹9,00,000 (monthly gross ₹75,000).
      // In FY2024_25: standard deduction = ₹75,000 -> Taxable = ₹8,25,000.
      // Slabs in FY2024_25:
      // 0-3L: 0% = 0
      // 3L-7L (4L): 5% = ₹20,000
      // 7L-8.25L (1.25L): 10% = ₹12,500
      // Base Tax = ₹32,500
      // Cess 4% = ₹1,300
      // Total Tax = ₹33,800
      // Nov 2024 (5 months remaining): ₹33,800 / 5 = ₹6,760.00
      const line = computePayslip({
        runId: 'run-nov-2024',
        month: 11,
        year: 2024,
        employee: {
          id: 'emp-9l-fy24',
          baseSalary: new Prisma.Decimal('75000.00'),
          statutoryProfile: {
            pfApplicable: false,
            esiApplicable: false,
            ptState: 'TN',
            tdsRegime: 'NEW',
          },
        },
        payRule: { workingDaysBasis: 'CALENDAR' },
        summary: { lopDays: 0, otHours: 0 },
      })

      const tdsStandalone = calculateMonthlyTds({
        regime: 'NEW',
        grossAnnualSalary: new Prisma.Decimal('900000.00'),
        financialYear: 'FY2024_25',
        remainingMonthsInFY: 5,
        previousTdsDeducted: 0,
      })

      expect(line.tds.greaterThan(new Prisma.Decimal("0.00"))).toBe(true)
      expect(line.tds.toFixed(2)).toBe('6760.00')
      expect(tdsStandalone.monthlyTds.toFixed(2)).toBe('6760.00')
      expect(line.tds.toFixed(2)).toBe(tdsStandalone.monthlyTds.toFixed(2))
    })
  })

  // 7.b: Taxable income ₹12L in FY2026_27 -> totalTax === 0
  describe('7.b: FY 2026-27 Slabs & Section 87A ₹12L Exemption', () => {
    it('produces totalTax === 0 for taxable income of exactly ₹12,00,000 under FY2026_27', () => {
      // Gross ₹12,75,000 - ₹75,000 standard deduction = ₹12,00,000 taxable
      // Slabs: 0-4L 0%, 4-8L 5% (₹20,000), 8-12L 10% (₹40,000) -> Base tax = ₹60,000
      // Full rebate up to ₹60,000 under Section 87A proviso -> Tax = 0
      const result = calculateAnnualTax({
        regime: 'NEW',
        grossAnnualSalary: new Prisma.Decimal('1275000.00'),
        financialYear: 'FY2026_27',
      })

      expect(result.taxableIncome.toFixed(2)).toBe('1200000.00')
      expect(result.baseTax.toFixed(2)).toBe('60000.00')
      expect(result.rebate87A.toFixed(2)).toBe('60000.00')
      expect(result.taxAfterRebate.toFixed(2)).toBe('0.00')
      expect(result.totalTax.toFixed(2)).toBe('0.00')
    })
  })

  // 7.c: Taxable income ₹12.1L in FY2026_27 -> marginal relief gives tax ~= ₹10,400
  describe('7.c: FY 2026-27 Marginal Relief u/s 87A', () => {
    it('applies marginal relief capping tax at excess income over ₹12,00,000 with 4% cess (~₹10,400)', () => {
      // Gross ₹12,85,000 - ₹75,000 standard deduction = ₹12,10,000 taxable income
      // Base tax without relief: ₹60,000 (up to 12L) + 15% of ₹10,000 (₹1,500) = ₹61,500
      // Excess income over ₹12,00,000 = ₹10,000
      // Marginal relief = ₹61,500 - ₹10,000 = ₹51,500
      // Tax after relief = ₹10,000
      // Health & Education Cess (4%) = ₹400
      // Total Tax = ₹10,400
      const result = calculateAnnualTax({
        regime: 'NEW',
        grossAnnualSalary: new Prisma.Decimal('1285000.00'),
        financialYear: 'FY2026_27',
      })

      expect(result.taxableIncome.toFixed(2)).toBe('1210000.00')
      expect(result.baseTax.toFixed(2)).toBe('61500.00')
      expect(result.marginalRelief.toFixed(2)).toBe('51500.00')
      expect(result.taxAfterRebate.toFixed(2)).toBe('10000.00')
      expect(result.cess.toFixed(2)).toBe('400.00')
      expect(result.totalTax.toFixed(2)).toBe('10400.00')
    })
  })

  // 7.d: FY resolution helper
  describe('7.d: Indian Financial Year Resolution', () => {
    it('resolves financial years correctly for both (year, month) and (month, year) signatures', () => {
      expect(resolveFinancialYear(2026, 3)).toBe('FY2025_26')
      expect(resolveFinancialYear(2026, 4)).toBe('FY2026_27')
      expect(resolveFinancialYear(3, 2026)).toBe('FY2025_26')
      expect(resolveFinancialYear(4, 2026)).toBe('FY2026_27')
      expect(resolveFinancialYear(11, 2026)).toBe('FY2026_27')
      expect(resolveFinancialYear(1, 2025)).toBe('FY2024_25')
      expect(resolveFinancialYear(6, 2024)).toBe('FY2024_25')
    })
  })

  // 7.e: Unknown FY error
  describe('7.e: Explicit Error on Unconfigured Financial Year', () => {
    it('throws explicit error when financial year is unconfigured (zero silent fallbacks)', () => {
      expect(() => resolveFinancialYear(1990, 5)).toThrow(
        'Tax configuration not found for financial year: FY1990_91'
      )
      expect(() => resolveFinancialYear(2035, 6)).toThrow(
        'Tax configuration not found for financial year: FY2035_36'
      )
      expect(() => resolveFinancialYear(2026, 13)).toThrow(
        'Invalid month: 13. Month must be between 1 and 12.'
      )
    })
  })

  // 7.f: previousTdsDeducted subtraction across months
  describe('7.f: Cumulative TDS Re-spread Across Months', () => {
    it('subtracts previousTdsDeducted and reduces remaining liability across months', () => {
      const grossAnnual = new Prisma.Decimal('1500000.00') // Total Tax = ₹97,500
      // Month 1 (April, 12 months remaining, 0 deducted)
      const m1 = calculateMonthlyTds({
        regime: 'NEW',
        grossAnnualSalary: grossAnnual,
        financialYear: 'FY2026_27',
        remainingMonthsInFY: 12,
        previousTdsDeducted: 0,
      })
      expect(m1.monthlyTds.toFixed(2)).toBe('8125.00')

      // Month 2 (May, 11 months remaining, ₹8,125 deducted)
      const m2 = calculateMonthlyTds({
        regime: 'NEW',
        grossAnnualSalary: grossAnnual,
        financialYear: 'FY2026_27',
        remainingMonthsInFY: 11,
        previousTdsDeducted: m1.monthlyTds,
      })
      expect(m2.remainingTaxLiability.toFixed(2)).toBe('89375.00')
      expect(m2.monthlyTds.toFixed(2)).toBe('8125.00')
    })
  })

  // 7.g: Section 288A & 288B Rounding (strict Decimal, no float)
  describe('7.g: Section 288A/B Rounding (roundToNearest10)', () => {
    it('rounds to nearest 10 using strict Decimal arithmetic', () => {
      expect(roundToNearest10(new Prisma.Decimal('1054.49')).toFixed(2)).toBe('1050.00')
      expect(roundToNearest10(new Prisma.Decimal('1055.00')).toFixed(2)).toBe('1060.00')
      expect(roundToNearest10(new Prisma.Decimal('1056.80')).toFixed(2)).toBe('1060.00')
      expect(roundToNearest10(new Prisma.Decimal('0.00')).toFixed(2)).toBe('0.00')
      expect(roundToNearest10(new Prisma.Decimal('4.99')).toFixed(2)).toBe('0.00')
      expect(roundToNearest10(new Prisma.Decimal('5.00')).toFixed(2)).toBe('10.00')
    })
  })

  // 7.h: computePayslip TDS Regime Missing Guard
  describe('7.h: computePayslip TDS Regime Configuration Guard', () => {
    it('throws PayrollCalculationError when employee TDS regime is missing or empty', () => {
      expect(() =>
        computePayslip({
          runId: 'run-guard',
          month: 11,
          year: 2026,
          employee: {
            id: 'emp-guard',
            baseSalary: new Prisma.Decimal('50000.00'),
            statutoryProfile: {
              pfApplicable: false,
              esiApplicable: false,
              ptState: 'TN',
              tdsRegime: '',
            },
          },
          payRule: { workingDaysBasis: 'CALENDAR' },
          summary: { lopDays: 0, otHours: 0 },
        })
      ).toThrow(PayrollCalculationError)
    })
  })
})
