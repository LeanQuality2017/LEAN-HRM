import { Prisma } from '@prisma/client'
import { add, div, max, min, round, sub, toDecimal, ZERO } from './money'

export interface AttendanceSummaryInput {
  presentDays?: Prisma.Decimal | string | number | null
  lopDays?: Prisma.Decimal | string | number | null
  otHours?: Prisma.Decimal | string | number | null
}

export interface CompanyPayRuleInput {
  workingDaysBasis: string // 'CALENDAR' | 'FIXED_26' | 'FIXED_30'
  lopDivisor?: Prisma.Decimal | string | number | null
  otMultiplier?: Prisma.Decimal | string | number | null
}

export interface EmployeeDatesInput {
  startDate?: Date | string | null
  endDate?: Date | string | null
}

export interface LopResult {
  totalMonthDays: Prisma.Decimal
  lopDays: Prisma.Decimal
  paidDays: Prisma.Decimal
  lopDivisor: Prisma.Decimal
  prorationFactor: Prisma.Decimal
  otHours: Prisma.Decimal
}

export interface ComputeLopOptions {
  employee?: EmployeeDatesInput | null
  month?: number
  year?: number
}

/**
 * Computes Loss of Pay (LOP) days, Paid days, and proration factor.
 * Pure function: supports CALENDAR, FIXED_26, FIXED_30 basis, explicit lopDivisor,
 * attendance LOP, full LOP months, and mid-month join / mid-month exit proration.
 */
export function computeLop(
  summary: AttendanceSummaryInput | null | undefined,
  payRule: CompanyPayRuleInput,
  options?: ComputeLopOptions
): LopResult {
  const now = new Date()
  const month = options?.month ?? now.getUTCMonth() + 1
  const year = options?.year ?? now.getUTCFullYear()

  // Calendar days in the payroll month (e.g., 28 in Feb, 30 in Apr, 31 in May)
  const calendarDaysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const calendarDaysDecimal = new Prisma.Decimal(calendarDaysInMonth)

  // Determine working days basis
  let totalMonthDays: Prisma.Decimal
  const basis = payRule.workingDaysBasis?.toUpperCase() ?? 'CALENDAR'
  if (basis === 'FIXED_26') {
    totalMonthDays = new Prisma.Decimal('26.00')
  } else if (basis === 'FIXED_30') {
    totalMonthDays = new Prisma.Decimal('30.00')
  } else {
    // Default: 'CALENDAR'
    totalMonthDays = calendarDaysDecimal
  }

  // Divisor for per-day calculations
  const lopDivisor =
    payRule.lopDivisor !== null && payRule.lopDivisor !== undefined && !toDecimal(payRule.lopDivisor).isZero()
      ? toDecimal(payRule.lopDivisor)
      : totalMonthDays

  // Calculate unworked calendar days due to mid-month join or exit
  const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  let unworkedCalendarDays = ZERO

  if (options?.employee?.startDate) {
    const start = new Date(options.employee.startDate)
    if (start > monthEnd) {
      // Not yet joined in this month
      unworkedCalendarDays = calendarDaysDecimal
    } else if (start > monthStart) {
      // Joined mid-month on day start.getUTCDate()
      const daysBeforeJoin = start.getUTCDate() - 1
      unworkedCalendarDays = add(unworkedCalendarDays, new Prisma.Decimal(daysBeforeJoin))
    }
  }

  if (options?.employee?.endDate) {
    const end = new Date(options.employee.endDate)
    if (end < monthStart) {
      // Already exited before this month
      unworkedCalendarDays = calendarDaysDecimal
    } else if (end < monthEnd) {
      // Exited mid-month on day end.getUTCDate()
      const daysAfterExit = calendarDaysInMonth - end.getUTCDate()
      unworkedCalendarDays = add(unworkedCalendarDays, new Prisma.Decimal(daysAfterExit))
    }
  }

  // Cap unworked calendar days to total calendar days
  unworkedCalendarDays = min(unworkedCalendarDays, calendarDaysDecimal)

  // Convert unworked calendar days to the pay rule's basis
  const unworkedBasisDays = round(
    div(unworkedCalendarDays.mul(totalMonthDays), calendarDaysDecimal),
    2
  )

  // Add attendance LOP (loss-of-pay reported during active employment)
  const attendanceLop = toDecimal(summary?.lopDays ?? 0)

  // Total LOP is the sum of unworked join/exit days and attendance LOP, capped at totalMonthDays
  const lopDays = round(min(totalMonthDays, add(unworkedBasisDays, attendanceLop)), 2)

  // Paid days = totalMonthDays - lopDays
  const paidDays = round(max(ZERO, sub(totalMonthDays, lopDays)), 2)

  // Proration factor (paidDays / lopDivisor)
  let prorationFactor: Prisma.Decimal
  if (paidDays.isZero()) {
    prorationFactor = ZERO
  } else if (paidDays.greaterThanOrEqualTo(lopDivisor)) {
    prorationFactor = new Prisma.Decimal('1.00')
  } else {
    prorationFactor = div(paidDays, lopDivisor)
  }

  const otHours = toDecimal(summary?.otHours ?? 0)

  return {
    totalMonthDays,
    lopDays,
    paidDays,
    lopDivisor,
    prorationFactor,
    otHours,
  }
}

