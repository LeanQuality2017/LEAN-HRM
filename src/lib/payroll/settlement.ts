import { Prisma } from '@prisma/client'
import { BONUS_CONFIG, GRATUITY_CONFIG } from './statutory-config'
import { toDecimal, round, add, sub, mul, div, min, max, ZERO } from './money'

export interface StatutoryBonusInput {
  basicSalary: Prisma.Decimal | number | string // Monthly Basic + DA
  daysWorkedInYear: number
  totalDaysInYear?: number // default 365
  bonusRate?: Prisma.Decimal | number | string | null // e.g. 0.0833 to 0.20
  minimumWage?: Prisma.Decimal | number | string | null
}

export interface StatutoryBonusResult {
  isEligible: boolean
  basicSalary: Prisma.Decimal
  calculationWage: Prisma.Decimal
  appliedRate: Prisma.Decimal
  daysWorked: number
  prorationFactor: Prisma.Decimal
  bonusAmount: Prisma.Decimal
  reason?: string
}

export interface GratuityInput {
  lastDrawnBasic: Prisma.Decimal | number | string // Monthly Basic + DA
  tenureYears: number
  tenureMonths?: number
  isDeathOrDisablement?: boolean
}

export interface GratuityResult {
  isEligible: boolean
  lastDrawnBasic: Prisma.Decimal
  completedYears: number
  completedMonths: number
  roundedYears: number
  uncappedAmount: Prisma.Decimal
  gratuityAmount: Prisma.Decimal
  isCapped: boolean
  reason?: string
}

export interface FullAndFinalInput {
  employeeId: string
  lastDrawnBasic: Prisma.Decimal | number | string
  lastDrawnGross: Prisma.Decimal | number | string
  unpaidSalaryDays?: number
  workedDaysInExitMonth?: number
  unpaidSalaryAmount?: Prisma.Decimal | number | string | null
  leaveEncashmentDays?: number
  leaveDivisor?: number // default 30 (or 26)
  gratuityAmount?: Prisma.Decimal | number | string | null
  gratuityInput?: GratuityInput | null
  bonusAmount?: Prisma.Decimal | number | string | null
  bonusInput?: StatutoryBonusInput | null
  otherAdditions?: Array<{ name: string; amount: Prisma.Decimal | number | string }>
  noticeShortfallDays?: number
  noticeDivisor?: number // default 30
  statutoryDeductions?: Prisma.Decimal | number | string | null
  assetRecovery?: Prisma.Decimal | number | string | null
  loanRecovery?: Prisma.Decimal | number | string | null
  otherDeductions?: Array<{ name: string; amount: Prisma.Decimal | number | string }>
}

export interface FullAndFinalResult {
  employeeId: string
  unpaidSalary: Prisma.Decimal
  leaveEncashment: Prisma.Decimal
  gratuity: Prisma.Decimal
  bonus: Prisma.Decimal
  otherAdditionsTotal: Prisma.Decimal
  totalAdditions: Prisma.Decimal
  noticeRecovery: Prisma.Decimal
  statutoryDeductions: Prisma.Decimal
  assetRecovery: Prisma.Decimal
  loanRecovery: Prisma.Decimal
  otherDeductionsTotal: Prisma.Decimal
  totalDeductions: Prisma.Decimal
  netPayable: Prisma.Decimal
  recoverableBalance: Prisma.Decimal
  additionsBreakdown: Array<{ name: string; amount: Prisma.Decimal }>
  deductionsBreakdown: Array<{ name: string; amount: Prisma.Decimal }>
}

/**
 * Computes statutory annual bonus under the Payment of Bonus Act, 1965.
 * - Minimum 30 working days in the accounting year.
 * - Wage eligibility ceiling ₹21,000/month.
 * - Calculation base capped at ₹7,000/month (or statutory minimum wage if higher).
 * - Rate clamped between 8.33% and 20.00%.
 */
export function statutoryBonus(input: StatutoryBonusInput): StatutoryBonusResult {
  const basic = max(ZERO, toDecimal(input.basicSalary))
  const daysWorked = Math.max(0, input.daysWorkedInYear)
  const totalDays = Math.max(1, input.totalDaysInYear ?? 365)

  // 1. Minimum 30 working days requirement
  if (daysWorked < BONUS_CONFIG.MIN_DAYS_WORKED.value) {
    return {
      isEligible: false,
      basicSalary: basic,
      calculationWage: ZERO,
      appliedRate: ZERO,
      daysWorked,
      prorationFactor: ZERO,
      bonusAmount: ZERO,
      reason: `Employee worked ${daysWorked} days, which is less than statutory minimum of ${BONUS_CONFIG.MIN_DAYS_WORKED.value} working days.`,
    }
  }

  // 2. Wage eligibility ceiling (Basic + DA <= ₹21,000)
  if (basic.greaterThan(BONUS_CONFIG.WAGE_ELIGIBILITY_CEILING.value)) {
    return {
      isEligible: false,
      basicSalary: basic,
      calculationWage: ZERO,
      appliedRate: ZERO,
      daysWorked,
      prorationFactor: ZERO,
      bonusAmount: ZERO,
      reason: `Monthly salary ₹${basic.toString()} exceeds statutory eligibility ceiling of ₹${BONUS_CONFIG.WAGE_ELIGIBILITY_CEILING.value.toString()}/month.`,
    }
  }

  // 3. Calculation ceiling wage: max(minimumWage, ₹7,000)
  const statutoryMinWage = input.minimumWage ? toDecimal(input.minimumWage) : BONUS_CONFIG.CALCULATION_WAGE_CEILING.value
  const calculationCeiling = max(BONUS_CONFIG.CALCULATION_WAGE_CEILING.value, statutoryMinWage)
  const calculationWage = min(basic, calculationCeiling)

  // 4. Rate clamped between 8.33% and 20.00%
  const requestedRate = input.bonusRate !== null && input.bonusRate !== undefined
    ? toDecimal(input.bonusRate)
    : BONUS_CONFIG.MIN_BONUS_RATE.value
  const appliedRate = min(BONUS_CONFIG.MAX_BONUS_RATE.value, max(BONUS_CONFIG.MIN_BONUS_RATE.value, requestedRate))

  // 5. Annual bonus calculation with day-based proration
  const annualCalculationBase = mul(calculationWage, new Prisma.Decimal('12.00'))
  const unproratedBonus = mul(annualCalculationBase, appliedRate)
  const prorationFactor = min(new Prisma.Decimal('1.00'), div(new Prisma.Decimal(daysWorked), new Prisma.Decimal(totalDays)))
  const bonusAmount = round(mul(unproratedBonus, prorationFactor), 2)

  return {
    isEligible: true,
    basicSalary: basic,
    calculationWage,
    appliedRate,
    daysWorked,
    prorationFactor: round(prorationFactor, 4),
    bonusAmount,
  }
}

/**
 * Computes statutory gratuity under the Payment of Gratuity Act, 1972.
 * - Formula: (15 / 26) * Last Drawn Basic * Rounded Tenure Years
 * - Minimum 5 completed years of continuous service (waived on death/disablement).
 * - Part-year rounding: remaining months > 6 rounds up to 1 full year; <= 6 ignored.
 * - Statutory ceiling cap of ₹20,00,000.
 */
export function gratuity(input: GratuityInput): GratuityResult {
  const basic = max(ZERO, toDecimal(input.lastDrawnBasic))
  const completedYears = Math.max(0, input.tenureYears)
  const completedMonths = Math.max(0, Math.min(11, input.tenureMonths ?? 0))
  const isExemptServiceRule = input.isDeathOrDisablement === true

  // 1. 5-Year continuous service requirement
  if (completedYears < GRATUITY_CONFIG.MIN_YEARS_SERVICE.value && !isExemptServiceRule) {
    return {
      isEligible: false,
      lastDrawnBasic: basic,
      completedYears,
      completedMonths,
      roundedYears: completedYears,
      uncappedAmount: ZERO,
      gratuityAmount: ZERO,
      isCapped: false,
      reason: `Service tenure of ${completedYears} years is less than statutory minimum of ${GRATUITY_CONFIG.MIN_YEARS_SERVICE.value} years.`,
    }
  }

  // 2. Part-year rounding policy (months > 6 rounds up to +1 year)
  const roundedYears = completedMonths > 6 ? completedYears + 1 : completedYears

  if (roundedYears === 0) {
    return {
      isEligible: true,
      lastDrawnBasic: basic,
      completedYears,
      completedMonths,
      roundedYears: 0,
      uncappedAmount: ZERO,
      gratuityAmount: ZERO,
      isCapped: false,
    }
  }

  // 3. Formula: (15 / 26) * Last Drawn Basic * Rounded Years
  // Basic / 26 * 15 * years
  const perDayRate = div(basic, GRATUITY_CONFIG.DAYS_DIVISOR.value)
  const fifteenDaysRate = mul(perDayRate, GRATUITY_CONFIG.DAYS_MULTIPLIER.value)
  const uncappedAmount = round(mul(fifteenDaysRate, new Prisma.Decimal(roundedYears)), 2)

  // 4. Statutory ceiling cap of ₹20,00,000
  const isCapped = uncappedAmount.greaterThan(GRATUITY_CONFIG.STATUTORY_CEILING.value)
  const gratuityAmount = isCapped ? GRATUITY_CONFIG.STATUTORY_CEILING.value : uncappedAmount

  return {
    isEligible: true,
    lastDrawnBasic: basic,
    completedYears,
    completedMonths,
    roundedYears,
    uncappedAmount,
    gratuityAmount,
    isCapped,
  }
}

/**
 * Computes Full & Final (F&F) Settlement with Net-Never-Negative invariant.
 * If total deductions exceed total additions, netPayable is 0.00 and the difference
 * is surfaced in recoverableBalance as debt to be recovered from the employee.
 */
export function fullAndFinal(input: FullAndFinalInput): FullAndFinalResult {
  const basic = max(ZERO, toDecimal(input.lastDrawnBasic))
  const gross = max(ZERO, toDecimal(input.lastDrawnGross))

  const additionsList: Array<{ name: string; amount: Prisma.Decimal }> = []
  const deductionsList: Array<{ name: string; amount: Prisma.Decimal }> = []

  // 1. Unpaid salary for exit month
  let unpaidSalary = ZERO
  if (input.unpaidSalaryAmount !== null && input.unpaidSalaryAmount !== undefined) {
    unpaidSalary = max(ZERO, toDecimal(input.unpaidSalaryAmount))
  } else if (input.workedDaysInExitMonth && input.workedDaysInExitMonth > 0) {
    // Pro-rate gross over 30 days
    unpaidSalary = round(mul(gross, div(new Prisma.Decimal(input.workedDaysInExitMonth), new Prisma.Decimal('30.00'))), 2)
  }
  if (unpaidSalary.greaterThan(ZERO)) {
    additionsList.push({ name: 'UNPAID_SALARY', amount: unpaidSalary })
  }

  // 2. Leave Encashment: leaveDays * (Basic / Divisor)
  let leaveEncashment = ZERO
  if (input.leaveEncashmentDays && input.leaveEncashmentDays > 0) {
    const divisor = new Prisma.Decimal(input.leaveDivisor && input.leaveDivisor > 0 ? input.leaveDivisor : 30)
    const perDayBasic = div(basic, divisor)
    leaveEncashment = round(mul(perDayBasic, new Prisma.Decimal(input.leaveEncashmentDays)), 2)
    additionsList.push({ name: 'LEAVE_ENCASHMENT', amount: leaveEncashment })
  }

  // 3. Gratuity
  let gratuityAmount = ZERO
  if (input.gratuityAmount !== null && input.gratuityAmount !== undefined) {
    gratuityAmount = max(ZERO, toDecimal(input.gratuityAmount))
  } else if (input.gratuityInput) {
    const gResult = gratuity(input.gratuityInput)
    gratuityAmount = gResult.gratuityAmount
  }
  if (gratuityAmount.greaterThan(ZERO)) {
    additionsList.push({ name: 'GRATUITY', amount: gratuityAmount })
  }

  // 4. Bonus
  let bonusAmount = ZERO
  if (input.bonusAmount !== null && input.bonusAmount !== undefined) {
    bonusAmount = max(ZERO, toDecimal(input.bonusAmount))
  } else if (input.bonusInput) {
    const bResult = statutoryBonus(input.bonusInput)
    bonusAmount = bResult.bonusAmount
  }
  if (bonusAmount.greaterThan(ZERO)) {
    additionsList.push({ name: 'STATUTORY_BONUS', amount: bonusAmount })
  }

  // 5. Other additions
  let otherAdditionsTotal = ZERO
  if (input.otherAdditions && input.otherAdditions.length > 0) {
    for (const a of input.otherAdditions) {
      const amt = max(ZERO, toDecimal(a.amount))
      if (amt.greaterThan(ZERO)) {
        otherAdditionsTotal = add(otherAdditionsTotal, amt)
        additionsList.push({ name: a.name, amount: amt })
      }
    }
  }

  const totalAdditions = add(add(add(add(unpaidSalary, leaveEncashment), gratuityAmount), bonusAmount), otherAdditionsTotal)

  // 6. Notice Period Recovery: noticeShortfallDays * (Gross / 30)
  let noticeRecovery = ZERO
  if (input.noticeShortfallDays && input.noticeShortfallDays > 0) {
    const divisor = new Prisma.Decimal(input.noticeDivisor && input.noticeDivisor > 0 ? input.noticeDivisor : 30)
    const perDayGross = div(gross, divisor)
    noticeRecovery = round(mul(perDayGross, new Prisma.Decimal(input.noticeShortfallDays)), 2)
    deductionsList.push({ name: 'NOTICE_PERIOD_RECOVERY', amount: noticeRecovery })
  }

  // 7. Statutory deductions
  const statutoryDeductions = input.statutoryDeductions ? max(ZERO, toDecimal(input.statutoryDeductions)) : ZERO
  if (statutoryDeductions.greaterThan(ZERO)) {
    deductionsList.push({ name: 'STATUTORY_DEDUCTIONS', amount: statutoryDeductions })
  }

  // 8. Asset recovery
  const assetRecovery = input.assetRecovery ? max(ZERO, toDecimal(input.assetRecovery)) : ZERO
  if (assetRecovery.greaterThan(ZERO)) {
    deductionsList.push({ name: 'ASSET_RECOVERY', amount: assetRecovery })
  }

  // 9. Loan recovery
  const loanRecovery = input.loanRecovery ? max(ZERO, toDecimal(input.loanRecovery)) : ZERO
  if (loanRecovery.greaterThan(ZERO)) {
    deductionsList.push({ name: 'LOAN_RECOVERY', amount: loanRecovery })
  }

  // 10. Other deductions
  let otherDeductionsTotal = ZERO
  if (input.otherDeductions && input.otherDeductions.length > 0) {
    for (const d of input.otherDeductions) {
      const amt = max(ZERO, toDecimal(d.amount))
      if (amt.greaterThan(ZERO)) {
        otherDeductionsTotal = add(otherDeductionsTotal, amt)
        deductionsList.push({ name: d.name, amount: amt })
      }
    }
  }

  const totalDeductions = add(add(add(add(noticeRecovery, statutoryDeductions), assetRecovery), loanRecovery), otherDeductionsTotal)

  // 11. Net-Never-Negative Invariant & Recoverable Balance
  let netPayable = ZERO
  let recoverableBalance = ZERO

  if (totalAdditions.greaterThanOrEqualTo(totalDeductions)) {
    netPayable = sub(totalAdditions, totalDeductions)
    recoverableBalance = ZERO
  } else {
    netPayable = ZERO
    recoverableBalance = sub(totalDeductions, totalAdditions)
  }

  return {
    employeeId: input.employeeId,
    unpaidSalary,
    leaveEncashment,
    gratuity: gratuityAmount,
    bonus: bonusAmount,
    otherAdditionsTotal,
    totalAdditions,
    noticeRecovery,
    statutoryDeductions,
    assetRecovery,
    loanRecovery,
    otherDeductionsTotal,
    totalDeductions,
    netPayable,
    recoverableBalance,
    additionsBreakdown: additionsList,
    deductionsBreakdown: deductionsList,
  }
}
