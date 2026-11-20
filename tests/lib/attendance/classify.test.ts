import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { classifyDay } from '@/lib/attendance/classify'

describe('Attendance Classification Logic (S13..S20)', () => {
  const shift8h = {
    startTime: '09:00',
    endTime: '17:00',
    breakMinutes: 0,
    graceMinutes: 15,
    weekoffMultiplier: new Prisma.Decimal('2.00'),
  }

  it('S13: classifyDay with a holiday -> status HOLIDAY, isLop false', () => {
    const res = classifyDay({
      dateKey: '2026-06-10',
      isHoliday: true,
      isWeekoff: false,
      punches: null,
      shift: shift8h,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe('HOLIDAY')
    expect(res.isLop).toBe(false)
    expect(res.otHours.toFixed(2)).toBe('0.00')
  })

  it('S14: classifyDay weekoff not worked -> WEEK_OFF, isLop false', () => {
    const res = classifyDay({
      dateKey: '2026-06-14', // Sunday
      isHoliday: false,
      isWeekoff: true,
      punches: null,
      shift: shift8h,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe('WEEK_OFF')
    expect(res.isLop).toBe(false)
    expect(res.otHours.toFixed(2)).toBe('0.00')
  })

  it('S15: classifyDay weekoff worked -> OT populated at weekoffMultiplier', () => {
    // 4 hours worked on weekoff (09:00 to 13:00 IST -> 03:30 to 07:30 UTC)
    const res = classifyDay({
      dateKey: '2026-06-14',
      isHoliday: false,
      isWeekoff: true,
      punches: {
        checkInUtc: '2026-06-14T03:30:00.000Z',
        checkOutUtc: '2026-06-14T07:30:00.000Z',
        source: 'BIOMETRIC',
      },
      shift: shift8h, // weekoffMultiplier: 2.00
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe('WEEK_OFF')
    expect(res.isLop).toBe(false)
    // 4h * 2.00 multiplier = 8.00 OT hours
    expect(res.otHours.toFixed(2)).toBe('8.00')
  })

  it('S16: classifyDay no punches on a working day -> ABSENT, isLop true', () => {
    const res = classifyDay({
      dateKey: '2026-06-10',
      isHoliday: false,
      isWeekoff: false,
      punches: null,
      shift: shift8h,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe('ABSENT')
    expect(res.isLop).toBe(true)
    expect(res.otHours.toFixed(2)).toBe('0.00')
  })

  it('S17: classifyDay worked 3h of an 8h shift -> HALF_DAY, isLop true', () => {
    // Worked 3h (09:00 to 12:00 IST -> 03:30 to 06:30 UTC). 3h < 4h threshold
    const res = classifyDay({
      dateKey: '2026-06-10',
      isHoliday: false,
      isWeekoff: false,
      punches: {
        checkInUtc: '2026-06-10T03:30:00.000Z',
        checkOutUtc: '2026-06-10T06:30:00.000Z',
        source: 'WEB',
      },
      shift: shift8h,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe('HALF_DAY')
    expect(res.isLop).toBe(true)
    expect(res.otHours.toFixed(2)).toBe('0.00')
  })

  it('S18: classifyDay worked 8h -> PRESENT, isLop false', () => {
    // Worked full 8h (09:00 to 17:00 IST -> 03:30 to 11:30 UTC)
    const res = classifyDay({
      dateKey: '2026-06-10',
      isHoliday: false,
      isWeekoff: false,
      punches: {
        checkInUtc: '2026-06-10T03:30:00.000Z',
        checkOutUtc: '2026-06-10T11:30:00.000Z',
        source: 'BIOMETRIC',
      },
      shift: shift8h,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe('PRESENT')
    expect(res.isLop).toBe(false)
    expect(res.otHours.toFixed(2)).toBe('0.00')
  })

  it('S19: Decimal exactness: 7.75 + 0.5 OT hours = 8.25 exactly', () => {
    const base = new Prisma.Decimal('7.75')
    const ot = new Prisma.Decimal('0.5')
    const total = base.add(ot)
    expect(total.toFixed(2)).toBe('8.25')
  })

  it('S20 (Classification Purity): no DB import in classify.ts, no new Date() without an argument', () => {
    const filePath = path.resolve(process.cwd(), 'src/lib/attendance/classify.ts')
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

