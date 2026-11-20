import { Prisma } from '@prisma/client'
import { ShiftLike, shiftWindowFor, isLate, overtimeHours } from './timezone'

export interface PunchesInput {
  checkInUtc?: string | null
  checkOutUtc?: string | null
  source?: string | null
}

export interface ClassifyDayInput {
  dateKey: string // "YYYY-MM-DD"
  isHoliday: boolean
  isWeekoff: boolean
  punches?: PunchesInput | null
  shift: ShiftLike
  timeZone: string
  halfDayThresholdMinutes?: number
}

export interface ClassifyDayResult {
  status: string
  lateMinutes: Prisma.Decimal
  earlyExitMinutes: Prisma.Decimal
  otHours: Prisma.Decimal
  isLop: boolean
}

const ZERO = new Prisma.Decimal('0.00')

/**
 * Pure attendance classification according to priority:
 * HOLIDAY > WEEK_OFF > LEAVE (handled outside) > ABSENT (no punches) > HALF_DAY (worked < halfDayThresholdMinutes) > WFH (from punch source) > LATE > PRESENT.
 * All durations and hours returned as Prisma.Decimal.
 */
export function classifyDay({
  dateKey,
  isHoliday,
  isWeekoff,
  punches,
  shift,
  timeZone,
  halfDayThresholdMinutes,
}: ClassifyDayInput): ClassifyDayResult {
  // 1. HOLIDAY (D5)
  if (isHoliday) {
    let otHours = ZERO
    if (punches?.checkInUtc && punches?.checkOutUtc) {
      const inMs = new Date(punches.checkInUtc).getTime()
      const outMs = new Date(punches.checkOutUtc).getTime()
      const diffMs = outMs - inMs
      if (diffMs > 0) {
        const grossMinutes = diffMs / 60000
        const breakM = shift.breakMinutes ?? 0
        const workedMinutes = Math.max(0, grossMinutes - breakM)
        const mult = new Prisma.Decimal(String(shift.weekoffMultiplier ?? 2.00))
        otHours = new Prisma.Decimal(workedMinutes)
          .div(new Prisma.Decimal(60))
          .mul(mult)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      }
    }
    return {
      status: 'HOLIDAY',
      lateMinutes: ZERO,
      earlyExitMinutes: ZERO,
      otHours,
      isLop: false,
    }
  }

  // 2. WEEK_OFF (D5)
  if (isWeekoff) {
    let otHours = ZERO
    if (punches?.checkInUtc && punches?.checkOutUtc) {
      const inMs = new Date(punches.checkInUtc).getTime()
      const outMs = new Date(punches.checkOutUtc).getTime()
      const diffMs = outMs - inMs
      if (diffMs > 0) {
        const grossMinutes = diffMs / 60000
        const breakM = shift.breakMinutes ?? 0
        const workedMinutes = Math.max(0, grossMinutes - breakM)
        const mult = new Prisma.Decimal(String(shift.weekoffMultiplier ?? 2.00))
        otHours = new Prisma.Decimal(workedMinutes)
          .div(new Prisma.Decimal(60))
          .mul(mult)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      }
    }
    return {
      status: 'WEEK_OFF',
      lateMinutes: ZERO,
      earlyExitMinutes: ZERO,
      otHours,
      isLop: false,
    }
  }

  // 3. Working Day: ABSENT when no punches exist
  if (!punches || !punches.checkInUtc) {
    return {
      status: 'ABSENT',
      lateMinutes: ZERO,
      earlyExitMinutes: ZERO,
      otHours: ZERO,
      isLop: true,
    }
  }

  // Calculate shift duration
  const [sH, sM] = shift.startTime.split(':').map((s) => parseInt(s, 10))
  const [eH, eM] = shift.endTime.split(':').map((s) => parseInt(s, 10))
  let schedMinutes = (eH * 60 + eM) - (sH * 60 + sM)
  if (schedMinutes <= 0) {
    schedMinutes += 24 * 60
  }

  const threshold = halfDayThresholdMinutes ?? Math.floor(schedMinutes / 2)

  const inMs = new Date(punches.checkInUtc).getTime()
  const outMs = punches.checkOutUtc ? new Date(punches.checkOutUtc).getTime() : 0
  const grossWorkedMinutes = outMs > inMs ? (outMs - inMs) / 60000 : 0

  // Late minutes relative to shift start
  const { startUtc, endUtc } = shiftWindowFor(dateKey, shift.startTime, shift.endTime, timeZone)
  const scheduledStartMs = new Date(startUtc).getTime()
  const scheduledEndMs = new Date(endUtc).getTime()

  const lateThresholdMs = scheduledStartMs + (shift.graceMinutes ?? 0) * 60 * 1000
  const lateMs = inMs - lateThresholdMs
  const lateMinutes = isLate(punches.checkInUtc, dateKey, shift, timeZone) && lateMs > 0
    ? new Prisma.Decimal(Math.floor(lateMs / 60000)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : ZERO

  const earlyExitMs = outMs > 0 ? scheduledEndMs - outMs : 0
  const earlyExitMinutes = earlyExitMs > 0
    ? new Prisma.Decimal(Math.floor(earlyExitMs / 60000)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : ZERO

  // HALF_DAY (worked < halfDayThresholdMinutes, only evaluated after checkout)
  if (punches.checkOutUtc && grossWorkedMinutes < threshold) {
    return {
      status: 'HALF_DAY',
      lateMinutes,
      earlyExitMinutes,
      otHours: ZERO,
      isLop: true,
    }
  }

  // Priority: WFH > LATE > PRESENT
  let status = 'PRESENT'
  if (punches.source === 'WFH') {
    status = 'WFH'
  } else if (isLate(punches.checkInUtc, dateKey, shift, timeZone)) {
    status = 'LATE'
  }

  const otHours = overtimeHours(punches.checkInUtc, punches.checkOutUtc, shift)

  return {
    status,
    lateMinutes,
    earlyExitMinutes,
    otHours,
    isLop: false,
  }
}

