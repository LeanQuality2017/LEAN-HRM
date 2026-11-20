import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import {
  toZonedParts,
  zonedDateKey,
  shiftWindowFor,
  isLate,
  overtimeHours,
} from '@/lib/attendance/timezone'

describe('Attendance Timezone & Shift Logic (S1..S12, S20)', () => {
  it('S1: toZonedParts converts 2026-06-10T23:30:00Z to Asia/Kolkata -> 2026-06-11 05:00', () => {
    const parts = toZonedParts('2026-06-10T23:30:00Z', 'Asia/Kolkata')
    expect(parts).toEqual({
      year: 2026,
      month: 6,
      day: 11,
      hour: 5,
      minute: 0,
    })
  })

  it('S2: zonedDateKey of a 23:30Z instant in IST is the NEXT local day', () => {
    const dateKey = zonedDateKey('2026-06-10T23:30:00Z', 'Asia/Kolkata')
    expect(dateKey).toBe('2026-06-11')
  })

  it('S3: zonedDateKey of the same instant in UTC is the SAME day (proves tz matters)', () => {
    const dateKeyUtc = zonedDateKey('2026-06-10T23:30:00Z', 'UTC')
    const dateKeyIst = zonedDateKey('2026-06-10T23:30:00Z', 'Asia/Kolkata')
    expect(dateKeyUtc).toBe('2026-06-10')
    expect(dateKeyIst).toBe('2026-06-11')
    expect(dateKeyUtc).not.toBe(dateKeyIst)
  })

  it('S4: Day-boundary: 18:29Z in IST is 23:59 same day; 18:31Z is 00:01 next day', () => {
    const boundaryBefore = toZonedParts('2026-06-10T18:29:00Z', 'Asia/Kolkata')
    expect(boundaryBefore).toEqual({
      year: 2026,
      month: 6,
      day: 10,
      hour: 23,
      minute: 59,
    })
    expect(zonedDateKey('2026-06-10T18:29:00Z', 'Asia/Kolkata')).toBe('2026-06-10')

    const boundaryAfter = toZonedParts('2026-06-10T18:31:00Z', 'Asia/Kolkata')
    expect(boundaryAfter).toEqual({
      year: 2026,
      month: 6,
      day: 11,
      hour: 0,
      minute: 1,
    })
    expect(zonedDateKey('2026-06-10T18:31:00Z', 'Asia/Kolkata')).toBe('2026-06-11')
  })

  it('S5: shiftWindowFor 09:30-18:30 IST -> correct UTC start/end for a Jun date', () => {
    const window = shiftWindowFor('2026-06-10', '09:30', '18:30', 'Asia/Kolkata')
    expect(window.startUtc).toBe('2026-06-10T04:00:00.000Z')
    expect(window.endUtc).toBe('2026-06-10T13:00:00.000Z')
  })

  it('S6: shiftWindowFor overnight 22:00-06:00 across DST-less tz -> endUtc is next local day', () => {
    const window = shiftWindowFor('2026-06-10', '22:00', '06:00', 'Asia/Kolkata')
    // 22:00 IST on 10 Jun -> 16:30 UTC on 10 Jun
    expect(window.startUtc).toBe('2026-06-10T16:30:00.000Z')
    // 06:00 IST on 11 Jun -> 00:30 UTC on 11 Jun
    expect(window.endUtc).toBe('2026-06-11T00:30:00.000Z')
  })

  it('S7: Overnight shift: a check-in 22:05 on 10 Jun + checkout 06:00 on 11 Jun = ONE row dated 10 Jun', () => {
    // 22:05 IST on 10 Jun -> 16:35 UTC on 10 Jun
    const checkInUtc = '2026-06-10T16:35:00.000Z'
    // 06:00 IST on 11 Jun -> 00:30 UTC on 11 Jun
    const checkOutUtc = '2026-06-11T00:30:00.000Z'

    const shiftDateKey = zonedDateKey(checkInUtc, 'Asia/Kolkata')
    expect(shiftDateKey).toBe('2026-06-10')

    const window = shiftWindowFor(shiftDateKey, '22:00', '06:00', 'Asia/Kolkata')
    expect(window.startUtc).toBe('2026-06-10T16:30:00.000Z')
    expect(window.endUtc).toBe('2026-06-11T00:30:00.000Z')

    // Both punches belong to the single shift date 2026-06-10
    expect(new Date(checkInUtc).getTime()).toBeGreaterThanOrEqual(new Date(window.startUtc).getTime())
    expect(new Date(checkOutUtc).getTime()).toBe(new Date(window.endUtc).getTime())
  })

  it('S8: isLate false at exactly shift start + grace', () => {
    const shift = { startTime: '09:30', endTime: '18:30', graceMinutes: 15 }
    // Scheduled start 09:30 IST (04:00Z) + 15 min grace = 09:45 IST (04:15Z)
    const exactGracePunch = '2026-06-10T04:15:00.000Z'
    const late = isLate(exactGracePunch, '2026-06-10', shift, 'Asia/Kolkata')
    expect(late).toBe(false)
  })

  it('S9: isLate true one minute past grace', () => {
    const shift = { startTime: '09:30', endTime: '18:30', graceMinutes: 15 }
    // Scheduled start 09:30 IST + 16 min (1 min past grace) = 09:46 IST (04:16Z)
    const pastGracePunch = '2026-06-10T04:16:00.000Z'
    const late = isLate(pastGracePunch, '2026-06-10', shift, 'Asia/Kolkata')
    expect(late).toBe(true)
  })

  it('S10: overtimeHours subtracts breakMinutes', () => {
    // 8-hour scheduled shift (09:00 to 17:00). Worker present for 10 hours (600 min).
    const checkIn = '2026-06-10T09:00:00.000Z'
    const checkOut = '2026-06-10T19:00:00.000Z'

    // Shift with 60 min break -> net worked: 9h. OT beyond 8h shift = 1.00h
    const shiftWithBreak = { startTime: '09:00', endTime: '17:00', breakMinutes: 60 }
    const otWithBreak = overtimeHours(checkIn, checkOut, shiftWithBreak)
    expect(otWithBreak.toFixed(2)).toBe('1.00')

    // Shift with 0 min break -> net worked: 10h. OT beyond 8h shift = 2.00h
    const shiftNoBreak = { startTime: '09:00', endTime: '17:00', breakMinutes: 0 }
    const otNoBreak = overtimeHours(checkIn, checkOut, shiftNoBreak)
    expect(otNoBreak.toFixed(2)).toBe('2.00')

    expect(otNoBreak.sub(otWithBreak).toFixed(2)).toBe('1.00')
  })

  it('S11: overtimeHours returns ZERO when checkOut missing', () => {
    const shift = { startTime: '09:00', endTime: '17:00', breakMinutes: 60 }
    const otMissingOut = overtimeHours('2026-06-10T09:00:00.000Z', null, shift)
    expect(otMissingOut.toFixed(2)).toBe('0.00')

    const otMissingIn = overtimeHours(null, '2026-06-10T17:00:00.000Z', shift)
    expect(otMissingIn.toFixed(2)).toBe('0.00')
  })

  it('S12: overtimeHours never negative', () => {
    const shift = { startTime: '09:00', endTime: '17:00', breakMinutes: 60 }
    // Worked only 4 hours on 8h shift -> OT is 0.00, not negative
    const otUnderworked = overtimeHours('2026-06-10T09:00:00.000Z', '2026-06-10T13:00:00.000Z', shift)
    expect(otUnderworked.toFixed(2)).toBe('0.00')
    expect(otUnderworked.isNegative()).toBe(false)

    // Inverted punch dates (checkout before checkin)
    const otInverted = overtimeHours('2026-06-10T17:00:00.000Z', '2026-06-10T09:00:00.000Z', shift)
    expect(otInverted.toFixed(2)).toBe('0.00')
    expect(otInverted.isNegative()).toBe(false)
  })

  it('S20 (Timezone Purity): no DB import in timezone.ts, no new Date() without an argument', () => {
    const filePath = path.resolve(process.cwd(), 'src/lib/attendance/timezone.ts')
    const content = fs.readFileSync(filePath, 'utf8')

    // No DB imports
    expect(content).not.toMatch(/from\s+['"].*\/db['"]/)
    expect(content).not.toMatch(/@prisma\/client.*db/)

    // No new Date() without argument
    expect(content).not.toMatch(/new\s+Date\(\s*\)/)

    // No Date.now()
    expect(content).not.toMatch(/Date\.now\(\s*\)/)
  })
})

