import { Prisma } from '@prisma/client'
import { EPF_CONFIG, ESI_CONFIG, PT_CONFIG } from './statutory-config'
import { ceilRupee, min, mul, round, ZERO } from './money'
import { PayrollCalculationError } from './errors'

/**
 * Computes PF Eligible Wages according to EPF Scheme.
 * PF wages are based on Basic + eligible allowances.
 * If pfCeiling is true, wages are capped at statutory ceiling (₹15,000).
 */
export function pfWages(basic: Prisma.Decimal, pfCeiling: boolean = true): Prisma.Decimal {
  if (basic.isZero() || basic.isNegative()) {
    return ZERO
  }
  if (pfCeiling) {
    return min(basic, EPF_CONFIG.WAGE_CEILING.value)
  }
  return basic
}

/**
 * Computes Employee Provident Fund (EPF) employee contribution (12% of PF Wages).
 */
export function epf(pfEligibleWages: Prisma.Decimal): Prisma.Decimal {
  if (pfEligibleWages.isZero() || pfEligibleWages.isNegative()) {
    return ZERO
  }
  return round(mul(pfEligibleWages, EPF_CONFIG.EMPLOYEE_RATE.value))
}

/**
 * Computes Employer EPS (Employee Pension Scheme) contribution (8.33% capped at wage ceiling).
 */
export function eps(pfEligibleWages: Prisma.Decimal): Prisma.Decimal {
  if (pfEligibleWages.isZero() || pfEligibleWages.isNegative()) {
    return ZERO
  }
  // EPS contribution is capped at the statutory ceiling (₹15,000 * 8.33% = ₹1,249.50)
  const cappedWages = min(pfEligibleWages, EPF_CONFIG.WAGE_CEILING.value)
  return round(mul(cappedWages, EPF_CONFIG.EMPLOYER_EPS_RATE.value))
}

/**
 * Computes ESI deductions for Employee (0.75%) and Employer (3.25%).
 * Under ESI Act, contributions apply if gross monthly wages <= ₹21,000.
 */
export function esi(
  gross: Prisma.Decimal,
  esiApplicable: boolean = true
): {
  employee: Prisma.Decimal
  employer: Prisma.Decimal
} {
  if (
    !esiApplicable ||
    gross.isZero() ||
    gross.isNegative() ||
    gross.greaterThan(ESI_CONFIG.WAGE_CEILING.value)
  ) {
    return {
      employee: ZERO,
      employer: ZERO,
    }
  }

  return {
    employee: ceilRupee(mul(gross, ESI_CONFIG.EMPLOYEE_RATE.value)),
    employer: ceilRupee(mul(gross, ESI_CONFIG.EMPLOYER_RATE.value)),
  }
}

/**
 * Computes Professional Tax based on state statutory slab schedule and monthly gross.
 */
export function professionalTax(state: string, monthlyGross: Prisma.Decimal): Prisma.Decimal {
  if (monthlyGross.isZero() || monthlyGross.isNegative()) {
    return ZERO
  }

  const normalizedState = state.trim().toUpperCase()
  const stateConfig = PT_CONFIG[normalizedState]

  if (!stateConfig) {
    throw new PayrollCalculationError(`Professional tax configuration missing for state: ${state}`)
  }

  for (const slab of stateConfig.slabs) {
    const aboveMin = monthlyGross.greaterThanOrEqualTo(slab.min)
    const belowMax = slab.max === null || monthlyGross.lessThanOrEqualTo(slab.max)
    if (aboveMin && belowMax) {
      return slab.monthlyTax
    }
  }

  return ZERO
}

