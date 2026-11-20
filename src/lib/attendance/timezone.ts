import { Prisma } from '@prisma/client'

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

export interface ShiftLike {
  startTime: string // "HH:mm" in company local time
  endTime: string   // "HH:mm"; if endTime <= startTime shift is overnight
  breakMinutes?: number
  graceMinutes?: number
  weekoffMultiplier?: Prisma.Decimal | number | string
}

/**
 * Extracts zoned calendar and time parts from a UTC instant in the given IANA timeZone.
 * Deterministic, pure, no third-party libraries.
 */
export function toZonedParts(utcInstant: string, timeZone: string): ZonedParts {
  const d = new Date(utcInstant)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(d)

  let year = 0
  let month = 0
  let day = 0
  let hour = 0
  let minute = 0

  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10)
    else if (part.type === 'month') month = parseInt(part.value, 10)
    else if (part.type === 'day') day = parseInt(part.value, 10)
    else if (part.type === 'hour') hour = parseInt(part.value, 10)
    else if (part.type === 'minute') minute = parseInt(part.value, 10)
  }

  return { year, month, day, hour, minute }
}

/**
 * Returns the shift date key "YYYY-MM-DD" for a UTC instant in the target timeZone (D2).
 */
export function zonedDateKey(utcInstant: string, timeZone: string): string {
  const { year, month, day } = toZonedParts(utcInstant, timeZone)
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/**
 * Converts local calendar date and time parts in timeZone to a UTC ISO string.
 * Uses an iterative fixed-point projection without external libraries.
 */
export function localToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): string {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const desiredLocal = Date.UTC(year, month - 1, day, hour, minute, 0, 0)

  for (let i = 0; i < 4; i++) {
    const zoned = toZonedParts(new Date(guess).toISOString(), timeZone)
    const actualLocal = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, 0, 0)
    const diff = desiredLocal - actualLocal
    if (diff === 0) break
    guess += diff
  }

  return new Date(guess).toISOString()
}

/**
 * Resolves the UTC start and end instants for a given dateKey and shift times.
 * Handles overnight shifts: if endTime <= startTime, endUtc is projected onto the next local day.
 */
export function shiftWindowFor(
  dateKey: string,
  startTime: string,
  endTime: string,
  timeZone: string
): { startUtc: string; endUtc: string } {
  const [yearStr, monthStr, dayStr] = dateKey.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)

  const [sH, sM] = startTime.split(':').map((s) => parseInt(s, 10))
  const [eH, eM] = endTime.split(':').map((s) => parseInt(s, 10))

  const startUtc = localToUtc(year, month, day, sH, sM, timeZone)

  const isOvernight = eH < sH || (eH === sH && eM <= sM)
  if (isOvernight) {
    const nextDayDate = new Date(Date.UTC(year, month - 1, day) + 86400000)
    const nextYear = nextDayDate.getUTCFullYear()
    const nextMonth = nextDayDate.getUTCMonth() + 1
    const nextDay = nextDayDate.getUTCDate()
    const endUtc = localToUtc(nextYear, nextMonth, nextDay, eH, eM, timeZone)
    return { startUtc, endUtc }
  }

  const endUtc = localToUtc(year, month, day, eH, eM, timeZone)
  return { startUtc, endUtc }
}

/**
 * Determines whether a check-in is late compared to the scheduled shift start + graceMinutes.
 */
export function isLate(
  actualCheckInUtc: string,
  dateKey: string,
  shift: ShiftLike,
  timeZone: string
): boolean {
  const { startUtc } = shiftWindowFor(dateKey, shift.startTime, shift.endTime, timeZone)
  const startMs = new Date(startUtc).getTime()
  const graceMs = (shift.graceMinutes ?? 0) * 60 * 1000
  const actualCheckInMs = new Date(actualCheckInUtc).getTime()
  return actualCheckInMs > startMs + graceMs
}

/**
 * Computes overtime hours worked beyond the scheduled shift duration in Decimal(6,2).
 * Subtracts breakMinutes; never returns negative; returns 0.00 if either punch is missing.
 */
export function overtimeHours(
  actualCheckInUtc: string | null | undefined,
  actualCheckOutUtc: string | null | undefined,
  shift: ShiftLike
): Prisma.Decimal {
  if (!actualCheckInUtc || !actualCheckOutUtc) {
    return new Prisma.Decimal('0.00')
  }

  const inMs = new Date(actualCheckInUtc).getTime()
  const outMs = new Date(actualCheckOutUtc).getTime()
  const diffMs = outMs - inMs
  if (diffMs <= 0) {
    return new Prisma.Decimal('0.00')
  }

  const grossWorkedMinutes = diffMs / 60000
  const breakMinutes = shift.breakMinutes ?? 0
  const netWorkedMinutes = Math.max(0, grossWorkedMinutes - breakMinutes)

  // Calculate scheduled shift span in minutes
  const [sH, sM] = shift.startTime.split(':').map((s) => parseInt(s, 10))
  const [eH, eM] = shift.endTime.split(':').map((s) => parseInt(s, 10))
  let schedMinutes = (eH * 60 + eM) - (sH * 60 + sM)
  if (schedMinutes <= 0) {
    schedMinutes += 24 * 60
  }

  const otMinutes = Math.max(0, netWorkedMinutes - schedMinutes)
  return new Prisma.Decimal(otMinutes)
    .div(new Prisma.Decimal(60))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

