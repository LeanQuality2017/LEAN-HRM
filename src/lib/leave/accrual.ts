import { Prisma } from '@prisma/client'
import { LeaveBalanceError } from './errors'

export interface LeaveAccrualRuleInput {
  frequency: string // 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'UPFRONT'
  amount: Prisma.Decimal | string | number
  carryForwardCap?: Prisma.Decimal | string | number
  expiryMonths?: number
  proRateOnJoin?: boolean
}

export interface ComputeAccrualParams {
  rule: LeaveAccrualRuleInput
  year: number
  joinDate?: Date | string | null
  asOfMonth: number // 1..12
}

export interface AccrualResult {
  credited: Prisma.Decimal
  projected: Prisma.Decimal
  creditedToDate: Prisma.Decimal
}

export interface PreviousBalanceInput {
  credited?: Prisma.Decimal | string | number
  carriedForward?: Prisma.Decimal | string | number
  used?: Prisma.Decimal | string | number
  lapsed?: Prisma.Decimal | string | number
}

export interface ApplyCarryForwardParams {
  previousBalance: PreviousBalanceInput | Prisma.Decimal | string | number
  rule: {
    carryForwardCap?: Prisma.Decimal | string | number
    expiryMonths?: number
  }
  monthsElapsed?: number
}

export interface CarryForwardResult {
  carriedForward: Prisma.Decimal
  lapsed: Prisma.Decimal
}

export interface ComputeAvailableParams {
  credited: Prisma.Decimal | string | number
  carriedForward?: Prisma.Decimal | string | number
  used?: Prisma.Decimal | string | number
  pending?: Prisma.Decimal | string | number
}

export type AvailableBalance = Prisma.Decimal & {
  available: Prisma.Decimal
  isOverdrawn: boolean
}

export interface AssertCanApplyParams {
  available: Prisma.Decimal | string | number
  requestedDays: Prisma.Decimal | string | number
  rule?: LeaveAccrualRuleInput
  isUnpaid?: boolean
}

const ZERO = new Prisma.Decimal('0.00')

/**
 * Normalizes any value to a Prisma.Decimal with 2 decimal places.
 */
export function toDecimal(val: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal {
  if (val == null || val === '') return ZERO
  try {
    const d = val instanceof Prisma.Decimal ? val : new Prisma.Decimal(val.toString())
    if (d.isNaN()) return ZERO
    return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
  } catch {
    return ZERO
  }
}

/**
 * Returns the leave year (financial year) for a given date.
 * Leave year starts April 1. E.g. 2026-04-15 -> 2026; 2027-02-10 -> 2026.
 */
export function getLeaveYear(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date
  const month = d.getUTCMonth() + 1
  return month >= 4 ? d.getUTCFullYear() : d.getUTCFullYear() - 1
}

/**
 * Returns UTC Date boundaries [yearStart, yearEnd] for a given leave year.
 */
export function getLeaveYearBoundaries(year: number): { yearStart: Date; yearEnd: Date } {
  const yearStart = new Date(Date.UTC(year, 3, 1, 0, 0, 0, 0))
  const yearEnd = new Date(Date.UTC(year + 1, 2, 31, 23, 59, 59, 999))
  return { yearStart, yearEnd }
}

/**
 * Standard leave year runs from 1 April (month 4) to 31 March (month 3) of next calendar year.
 * Converts calendar month (1..12) to sequential month index (1..12) where April is 1, March is 12.
 */
function getLeaveYearMonthIndex(calendarMonth: number): number {
  return calendarMonth >= 4 ? calendarMonth - 3 : calendarMonth + 9
}

/**
 * Resolves the number of credits due so far this leave year as of `asOfMonth`.
 * Pure function: relies entirely on deterministic inputs, no Date.now().
 */
export function resolveAccrualMonths(
  rule: LeaveAccrualRuleInput,
  year: number,
  joinDate?: Date | string | null,
  asOfMonth: number = 4
): number {
  const freq = (rule.frequency || '').toUpperCase()
  const proRate = rule.proRateOnJoin ?? true

  // Year boundaries in UTC: 1 April of `year` to 31 March of `year + 1`
  const yearStart = new Date(Date.UTC(year, 3, 1)) // 1 Apr
  const yearEnd = new Date(Date.UTC(year + 1, 2, 31, 23, 59, 59, 999)) // 31 Mar

  const parsedJoin = joinDate ? new Date(joinDate) : null
  const joinedBeforeOrAtStart = !parsedJoin || parsedJoin <= yearStart

  // If joined after year end, no credits due
  if (parsedJoin && parsedJoin > yearEnd) {
    return 0
  }

  const asOfIndex = getLeaveYearMonthIndex(asOfMonth)

  // Determine join month index relative to leave year
  let joinIndex = 1
  let isMidMonthJoin = false
  if (parsedJoin && parsedJoin > yearStart) {
    const jMonth = parsedJoin.getUTCMonth() + 1
    const jDay = parsedJoin.getUTCDate()
    joinIndex = getLeaveYearMonthIndex(jMonth)
    // If joined after the 1st of the month, that month is not a full completed month
    if (jDay > 1) {
      isMidMonthJoin = true
    }
  }

  if (freq === 'UPFRONT' || freq === 'YEARLY') {
    if (joinedBeforeOrAtStart) {
      return 1
    }
    // Mid-year join
    if (!proRate) {
      return 1
    }
    // Pro-rate based on remaining months in the leave year from join month
    // If joined 1 Oct (month 10, index 7): months remaining are 7..12 = 6 months out of 12 = 0.5 credits
    const remainingMonths = Math.max(0, 12 - joinIndex + (isMidMonthJoin ? 0 : 1))
    return remainingMonths / 12
  }

  if (freq === 'MONTHLY') {
    // For mid-month join, the first completed month is the subsequent month
    const effectiveStartMonthIndex = isMidMonthJoin ? joinIndex + 1 : joinIndex
    if (asOfIndex < effectiveStartMonthIndex) {
      return 0
    }
    return asOfIndex - effectiveStartMonthIndex + 1
  }

  if (freq === 'QUARTERLY') {
    // Quarters land on Jul (month 7), Oct (month 10), Jan (month 1)
    // Q1 ends Jun 30 -> lands Jul (month 7, leave-index 4) -> 1 credit
    // Q2 ends Sep 30 -> lands Oct (month 10, leave-index 7) -> 2 credits
    // Q3 ends Dec 31 -> lands Jan (month 1, leave-index 10) -> 3 credits
    if (asOfMonth === 7 || (asOfIndex >= 4 && asOfIndex < 7)) {
      return 1
    }
    if (asOfMonth === 10 || (asOfIndex >= 7 && asOfIndex < 10)) {
      return 2
    }
    if (asOfMonth === 1 || asOfIndex >= 10) {
      return 3
    }
    return 0
  }

  return 0
}

/**
 * Computes leave accrual credit to date and projected full-year credits.
 */
export function computeAccrual({
  rule,
  year,
  joinDate,
  asOfMonth,
}: ComputeAccrualParams): AccrualResult {
  const baseAmount = toDecimal(rule.amount)
  const creditsFactor = resolveAccrualMonths(rule, year, joinDate, asOfMonth)
  const credited = baseAmount.mul(new Prisma.Decimal(creditsFactor.toString())).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)

  // Projected annual credits
  const totalYearCredits = resolveAccrualMonths(rule, year, joinDate, 3) // month 3 = March (year end)
  const projected = baseAmount.mul(new Prisma.Decimal(totalYearCredits.toString())).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)

  return {
    credited,
    projected,
    creditedToDate: credited,
  }
}

/**
 * Applies carry-forward cap and expiry rules to previous year leave balances.
 */
export function applyCarryForward({
  previousBalance,
  rule,
  monthsElapsed = 0,
}: ApplyCarryForwardParams): CarryForwardResult {
  let available: Prisma.Decimal
  if (typeof previousBalance === 'object' && previousBalance !== null && !(previousBalance instanceof Prisma.Decimal)) {
    const credited = toDecimal(previousBalance.credited)
    const carried = toDecimal(previousBalance.carriedForward)
    const used = toDecimal(previousBalance.used)
    available = credited.add(carried).sub(used)
  } else {
    available = toDecimal(previousBalance)
  }

  if (available.lessThanOrEqualTo(ZERO)) {
    return {
      carriedForward: ZERO,
      lapsed: ZERO,
    }
  }

  const cap = toDecimal(rule.carryForwardCap ?? ZERO)
  const expiry = rule.expiryMonths ?? 0

  // If expiryMonths > 0 and balance is older than expiryMonths, everything lapses
  if (expiry > 0 && monthsElapsed >= expiry) {
    return {
      carriedForward: ZERO,
      lapsed: available,
    }
  }

  // Cap of 0 means no carry forward allowed: everything lapses
  if (cap.isZero()) {
    return {
      carriedForward: ZERO,
      lapsed: available,
    }
  }

  if (available.greaterThan(cap)) {
    return {
      carriedForward: cap,
      lapsed: available.sub(cap),
    }
  }

  return {
    carriedForward: available,
    lapsed: ZERO,
  }
}

/**
 * Computes available balance clamped at 0. Never returns a negative number.
 * Returns an object that is both an instanceof Prisma.Decimal and carries an `isOverdrawn` flag.
 */
export function computeAvailableBalance({
  credited,
  carriedForward = ZERO,
  used = ZERO,
  pending = ZERO,
}: ComputeAvailableParams): AvailableBalance {
  const c = toDecimal(credited)
  const cf = toDecimal(carriedForward)
  const u = toDecimal(used)
  const p = toDecimal(pending)

  const totalCredit = c.add(cf)
  const totalDebits = u.add(p)
  const net = totalCredit.sub(totalDebits)

  const isOverdrawn = net.isNegative()
  const clamped = isOverdrawn ? ZERO : net.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)

  // Attach properties to decimal instance so it functions both as Decimal and object
  const result = clamped as AvailableBalance
  result.isOverdrawn = isOverdrawn
  result.available = clamped

  return result
}

/**
 * Asserts that an employee can apply for the requested leave duration.
 * Throws LeaveBalanceError if requestedDays > available. Unpaid leave (LOP) is always allowed.
 */
export function assertCanApply({
  available,
  requestedDays,
  isUnpaid = false,
}: AssertCanApplyParams): boolean {
  if (isUnpaid) {
    return true
  }

  const availDec = toDecimal(available)
  const reqDec = toDecimal(requestedDays)

  if (reqDec.lessThanOrEqualTo(availDec)) {
    return true
  }

  throw new LeaveBalanceError(
    `Insufficient leave balance: available ${availDec.toString()}, requested ${reqDec.toString()}`
  )
}

