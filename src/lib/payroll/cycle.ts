import { getDaysInMonth, isLeapYear } from 'date-fns'

export type PayrollCycleType =
  | '1ST_TO_MONTH_END'
  | '26TH_TO_25TH'
  | 'CALENDAR_MONTH'
  | 'CUSTOM_CUTOFF'

export interface PayrollCycleOptions {
  cycleType?: PayrollCycleType
  cutoffDay?: number // Cutoff day for cycle (e.g. 25 for 26th-to-25th)
}

export interface PayrollCycle {
  year: number
  month: number // 1-12
  cycleType: PayrollCycleType
  startDate: Date
  endDate: Date
  startDateISO: string // YYYY-MM-DD
  endDateISO: string   // YYYY-MM-DD
  totalDays: number
  isLeapYear: boolean
  daysInMonth: number
  dates: string[] // List of all YYYY-MM-DD date strings in this cycle
}

const MS_PER_DAY = 86400000

/**
 * OD-P1: Dynamic Payroll Calendar Engine
 * Dynamically computes payroll periods and calendar days without hardcoded 28/29/30/31 values.
 * Automatically handles leap years (e.g. Feb 2028 = 29 days) and month boundary transitions
 * for both 1st-to-Month-End and 26th-to-25th cycles.
 */
export function getPayrollCycle(
  year: number,
  month: number, // 1 = January, 12 = December
  options?: PayrollCycleOptions
): PayrollCycle {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}. Must be between 1 and 12.`)
  }

  const cycleType = options?.cycleType ?? '1ST_TO_MONTH_END'
  const monthDate = new Date(Date.UTC(year, month - 1, 1))
  const daysInMonth = getDaysInMonth(monthDate)
  const leap = isLeapYear(monthDate)

  let startDate: Date
  let endDate: Date

  if (cycleType === '26TH_TO_25TH' || cycleType === 'CUSTOM_CUTOFF') {
    const cutoff = options?.cutoffDay ?? 25
    const startDay = cutoff + 1

    // Previous month (e.g. if month is March 2028, start from Feb 26, 2028)
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year

    startDate = new Date(Date.UTC(prevYear, prevMonth - 1, startDay, 0, 0, 0, 0))
    endDate = new Date(Date.UTC(year, month - 1, cutoff, 0, 0, 0, 0))
  } else {
    // Default: '1ST_TO_MONTH_END' or 'CALENDAR_MONTH'
    startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
    endDate = new Date(Date.UTC(year, month - 1, daysInMonth, 0, 0, 0, 0))
  }

  // Pure calendar day count across UTC date boundaries
  const startUtcMs = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
  const endUtcMs = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
  const totalDays = Math.round((endUtcMs - startUtcMs) / MS_PER_DAY) + 1

  // Dynamically generate all ISO dates in this cycle
  const dates: string[] = []
  let curUtc = startUtcMs
  while (curUtc <= endUtcMs) {
    const d = new Date(curUtc)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    dates.push(`${y}-${m}-${day}`)
    curUtc += MS_PER_DAY
  }

  const startDateISO = dates[0]
  const endDateISO = dates[dates.length - 1]

  return {
    year,
    month,
    cycleType,
    startDate,
    endDate,
    startDateISO,
    endDateISO,
    totalDays,
    isLeapYear: leap,
    daysInMonth,
    dates,
  }
}

/**
 * Derives cycle type and period dynamically for a specific company's pay rule.
 */
export function getCompanyPayrollCycle(
  payRule: { payrollCutoffDay?: number | null; workingDaysBasis?: string | null },
  year: number,
  month: number
): PayrollCycle {
  const cutoff = payRule.payrollCutoffDay ?? 25
  // POLICY classification threshold: determines which cutoff days count as
  // mid-month cutoff cycles (e.g. 26th-to-25th) vs. calendar month cycles (1st-to-end),
  // not calendar math.
  const isCutoffCycle = cutoff < 28 && cutoff > 0

  return getPayrollCycle(year, month, {
    cycleType: isCutoffCycle ? '26TH_TO_25TH' : '1ST_TO_MONTH_END',
    cutoffDay: cutoff,
  })
}
