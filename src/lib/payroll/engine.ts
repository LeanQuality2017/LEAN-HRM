import { Prisma } from '@prisma/client'
import { add, div, mul, round, sub, toDecimal, ZERO } from './money'
import { resolveStructure, EmployeeSalaryInput } from './salary'
import { computeLop, CompanyPayRuleInput, EmployeeDatesInput, AttendanceSummaryInput } from './attendance'
import { epf, eps, esi, pfWages, professionalTax } from './statutory'
import { calculateMonthlyTds, resolveFinancialYear, DeclaredDeductionsInput } from './tds'
import { PayrollCalculationError } from './errors'
import { EPF_CONFIG } from './statutory-config'

export { PayrollCalculationError } from './errors'

export interface StatutoryProfileInput {
  pfApplicable?: boolean
  pfCeiling?: boolean
  esiApplicable?: boolean
  ptState?: string
  tdsRegime?: string | null
}

export interface RunContext {
  runId: string
  companyId?: string
  month: number
  year: number
  employee: EmployeeSalaryInput &
    EmployeeDatesInput & {
      hourlyRate?: Prisma.Decimal | string | number | null
      statutoryProfile?: StatutoryProfileInput | null
    }
  payRule: CompanyPayRuleInput
  summary?: AttendanceSummaryInput | null
  previousTdsDeducted?: Prisma.Decimal | string | number | null
  declaredDeductions?: DeclaredDeductionsInput | null
}

export interface PayrollLineDraft {
  runId: string
  employeeId: string
  gross: Prisma.Decimal
  deductions: Prisma.Decimal
  statutory: Prisma.Decimal
  tds: Prisma.Decimal
  net: Prisma.Decimal
  daysPaid: Prisma.Decimal
  lopDays: Prisma.Decimal
  componentBreakdown: string
}

/**
 * Pure calculation engine for a single employee's payslip.
 * Completely dependency-free and DB-free.
 * 
 * Flow:
 * 1. Computes LOP and paid days proration via computeLop
 * 2. Resolves effective salary structure via resolveStructure
 * 3. Prorates earning components
 * 4. Calculates overtime (OT)
 * 5. Calculates statutory deductions (PF, ESI, PT, TDS)
 * 6. Calculates total deductions
 * 7. Applies Negative Net Guard
 * 8. Returns draft PayrollLine with comprehensive JSON snapshot
 */
export function computePayslip(context: RunContext): PayrollLineDraft {
  // 1. Attendance & Proration
  const attendance = computeLop(context.summary, context.payRule, {
    employee: context.employee,
    month: context.month,
    year: context.year,
  })

  // 2. Resolve Structure
  const structure = resolveStructure(context.employee, context.month, context.year)

  // 3. Prorate Earnings
  const proratedEarnings: Array<{ name: string; amount: Prisma.Decimal }> = []
  let proratedGross = ZERO
  let proratedBasic = ZERO

  if (attendance.paidDays.isZero() || structure.gross.isZero()) {
    // Full LOP or Zero salary
    for (const comp of structure.components.filter((c) => c.type === 'EARNING')) {
      proratedEarnings.push({ name: comp.name, amount: ZERO })
    }
  } else {
    for (const comp of structure.components.filter((c) => c.type === 'EARNING')) {
      const prorated = round(mul(comp.amount, attendance.prorationFactor))
      proratedEarnings.push({ name: comp.name, amount: prorated })
      proratedGross = add(proratedGross, prorated)
      if (comp.name === 'BASIC') {
        proratedBasic = prorated
      }
    }
  }

  // 4. Overtime Calculation
  let otAmount = ZERO
  if (attendance.otHours.greaterThan(ZERO)) {
    const otMultiplier = toDecimal(context.payRule.otMultiplier ?? new Prisma.Decimal('1.50'))
    let hourlyRate: Prisma.Decimal

    if (context.employee.hourlyRate && !toDecimal(context.employee.hourlyRate).isZero()) {
      hourlyRate = toDecimal(context.employee.hourlyRate)
    } else if (structure.basic.greaterThan(ZERO) && attendance.totalMonthDays.greaterThan(ZERO)) {
      // Standard hourly rate derivation: Basic / (WorkingDays * 8 hours/day)
      const standardMonthlyHours = mul(attendance.totalMonthDays, new Prisma.Decimal('8.00'))
      hourlyRate = round(div(structure.basic, standardMonthlyHours), 4)
    } else {
      hourlyRate = ZERO
    }

    otAmount = round(mul(mul(attendance.otHours, hourlyRate), otMultiplier))
    if (otAmount.greaterThan(ZERO)) {
      proratedEarnings.push({ name: 'OVERTIME', amount: otAmount })
      proratedGross = add(proratedGross, otAmount)
    }
  }

  // 5. Statutory Deductions
  const profile = context.employee.statutoryProfile ?? {
    pfApplicable: true,
    pfCeiling: true,
    esiApplicable: false,
    ptState: 'TN',
    tdsRegime: 'NEW',
  }

  // EPF
  let employeePf = ZERO
  let employerEpf = ZERO
  let employerEps = ZERO
  if (profile.pfApplicable !== false && proratedBasic.greaterThan(ZERO)) {
    const eligiblePfWage = pfWages(proratedBasic, profile.pfCeiling !== false)
    employeePf = epf(eligiblePfWage)
    employerEpf = round(mul(eligiblePfWage, EPF_CONFIG.EMPLOYER_EPF_RATE.value))
    employerEps = eps(eligiblePfWage)
  }

  // ESI
  let employeeEsi = ZERO
  let employerEsi = ZERO
  if (profile.esiApplicable === true && proratedGross.greaterThan(ZERO)) {
    const esiResult = esi(proratedGross, true)
    employeeEsi = esiResult.employee
    employerEsi = esiResult.employer
  }

  // Professional Tax
  let pt = ZERO
  if (profile.ptState && proratedGross.greaterThan(ZERO)) {
    pt = professionalTax(profile.ptState, proratedGross)
  }

  // TDS
  let tax = ZERO
  if (profile.tdsRegime && profile.tdsRegime.trim() !== '') {
    const fy = resolveFinancialYear(context.month, context.year)
    const monthInFY = context.month >= 4 ? context.month - 3 : context.month + 9
    const remainingMonthsInFY = Math.max(1, 12 - monthInFY + 1)
    const grossAnnualSalary = mul(structure.gross, new Prisma.Decimal('12.00'))

    const tdsResult = calculateMonthlyTds({
      regime: profile.tdsRegime,
      grossAnnualSalary,
      declaredDeductions: context.declaredDeductions ?? null,
      financialYear: fy,
      currentMonth: monthInFY,
      remainingMonthsInFY,
      previousTdsDeducted: context.previousTdsDeducted ? toDecimal(context.previousTdsDeducted) : ZERO,
    })

    tax = tdsResult.monthlyTds
  } else {
    throw new PayrollCalculationError('TDS regime not configured')
  }

  const statutory = add(add(add(employeePf, employeeEsi), pt), tax)

  // 6. Fixed / Non-statutory Deductions
  let otherDeductions = ZERO
  const proratedDeductionsList: Array<{ name: string; amount: Prisma.Decimal }> = []
  for (const comp of structure.components.filter((c) => c.type === 'DEDUCTION')) {
    // If not full LOP, apply fixed deduction
    const amount = attendance.paidDays.isZero() ? ZERO : comp.amount
    otherDeductions = add(otherDeductions, amount)
    proratedDeductionsList.push({ name: comp.name, amount })
  }

  const totalDeductions = add(statutory, otherDeductions)

  // 7. Net Pay & Negative Net Guard
  const net = sub(proratedGross, totalDeductions)

  if (net.isNegative()) {
    throw new PayrollCalculationError(
      `Negative net salary (Net: ₹${net.toString()}, Gross: ₹${proratedGross.toString()}, Deductions: ₹${totalDeductions.toString()}) for employee ${context.employee.id}. Total deductions exceed gross earnings.`
    )
  }

  // 8. Snapshot Breakdown
  const componentBreakdown = JSON.stringify({
    month: context.month,
    year: context.year,
    earnings: proratedEarnings,
    deductions: proratedDeductionsList,
    statutory: {
      pf: {
        employee: employeePf,
        employerEpf,
        employerEps,
      },
      esi: {
        employee: employeeEsi,
        employer: employerEsi,
      },
      professionalTax: pt,
      tds: tax,
    },
    attendance: {
      totalMonthDays: attendance.totalMonthDays,
      paidDays: attendance.paidDays,
      lopDays: attendance.lopDays,
      otHours: attendance.otHours,
      otAmount,
    },
  })

  return {
    runId: context.runId,
    employeeId: context.employee.id,
    gross: round(proratedGross),
    deductions: round(totalDeductions),
    statutory: round(statutory),
    tds: round(tax),
    net: round(net),
    daysPaid: attendance.paidDays,
    lopDays: attendance.lopDays,
    componentBreakdown,
  }
}
