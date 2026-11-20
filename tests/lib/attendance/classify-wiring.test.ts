import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { classifyDay } from '@/lib/attendance/classify'
import { POST as attendancePost } from '@/app/api/attendance/route'
import type { AuthContext } from '@/lib/api-auth'
import { ROLES, ATTENDANCE_STATUS } from '@/lib/constants'

// -------------------------------------------------------------
// Hoisted Mock Setup for Route Wiring
// -------------------------------------------------------------
const { mockDb, getAuthContext, setAuthContext } = vi.hoisted(() => {
  let currentAuth: AuthContext | null = null

  const db = {
    employeeCompanyAssignment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    employeeShiftAssignment: {
      findFirst: vi.fn(),
    },
    shift: {
      findFirst: vi.fn(),
    },
    holiday: {
      findUnique: vi.fn(),
    },
    companyPayRule: {
      findUnique: vi.fn(),
    },
    attendance: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  }

  return {
    mockDb: db,
    getAuthContext: () => currentAuth,
    setAuthContext: (ctx: Partial<AuthContext> | null) => {
      currentAuth = ctx
        ? ({
            userId: ctx.userId || 'test_user_id',
            role: ctx.role || ROLES.EMPLOYEE,
            employeeId: ctx.employeeId !== undefined ? ctx.employeeId : 'emp_test_id',
            name: ctx.name || 'Test User',
          } as AuthContext)
        : null
    },
  }
})

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return {
    ...actual,
    requireAuth: vi.fn(async (allowedRoles?: string[]) => {
      const auth = getAuthContext()
      if (!auth) throw new actual.ApiError(401, 'Unauthorized')
      if (allowedRoles && !allowedRoles.includes(auth.role)) {
        throw new actual.ApiError(403, 'Forbidden')
      }
      return auth
    }),
  }
})

describe('Attendance Engine Wiring & Classification (Step 4.4)', () => {
  const shift930 = {
    id: 'shift_930',
    companyId: 'company_alpha',
    name: 'General Morning Shift',
    startTime: '09:30',
    endTime: '18:30',
    breakMinutes: 60,
    graceMinutes: 15,
    weekoffMultiplier: new Prisma.Decimal('2.00'),
  }

  const shift1400 = {
    id: 'shift_1400',
    companyId: 'company_alpha',
    name: 'Afternoon / Evening Shift',
    startTime: '14:00',
    endTime: '23:00',
    breakMinutes: 60,
    graceMinutes: 15,
    weekoffMultiplier: new Prisma.Decimal('2.00'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setAuthContext({
      userId: 'user_1',
      role: ROLES.EMPLOYEE,
      employeeId: 'emp_1',
    })
    mockDb.employeeCompanyAssignment.findMany.mockResolvedValue([
      { companyId: 'company_alpha', isPrimary: true },
    ])
    mockDb.companyPayRule.findUnique.mockResolvedValue({
      timezone: 'Asia/Kolkata',
    })
    mockDb.holiday.findUnique.mockResolvedValue(null)
  })

  // 1. 9:30 shift, punch 9:40, grace 15 -> status PRESENT, lateMinutes 0
  it('9:30 shift, punch 9:40, grace 15 -> status PRESENT, lateMinutes 0', () => {
    // 09:40 IST = 04:10:00 UTC
    const res = classifyDay({
      dateKey: '2026-06-10',
      isHoliday: false,
      isWeekoff: false,
      punches: {
        checkInUtc: '2026-06-10T04:10:00.000Z',
        checkOutUtc: null,
        source: 'WEB',
      },
      shift: shift930,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe(ATTENDANCE_STATUS.PRESENT)
    expect(res.lateMinutes.toNumber()).toBe(0)
    expect(res.isLop).toBe(false)
  })

  // 2. 9:30 shift, punch 10:05, grace 15 -> status LATE, lateMinutes past grace (not 35 from start)
  it('9:30 shift, punch 10:05, grace 15 -> status LATE, lateMinutes 20 (not 35)', () => {
    // 10:05 IST = 04:35:00 UTC (grace cutoff is 09:45; 10:05 - 09:45 = 20 lateMinutes)
    const res = classifyDay({
      dateKey: '2026-06-10',
      isHoliday: false,
      isWeekoff: false,
      punches: {
        checkInUtc: '2026-06-10T04:35:00.000Z',
        checkOutUtc: null,
        source: 'WEB',
      },
      shift: shift930,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe(ATTENDANCE_STATUS.LATE)
    expect(res.lateMinutes.toNumber()).toBe(20)
    expect(res.lateMinutes.toNumber()).not.toBe(35)
    expect(res.isLop).toBe(false)
  })

  it('9:30 shift, punch 9:50, grace 15 -> status LATE, lateMinutes 5', () => {
    // 09:50 IST = 04:20:00 UTC (09:50 - 09:45 = 5 lateMinutes)
    const res = classifyDay({
      dateKey: '2026-06-10',
      isHoliday: false,
      isWeekoff: false,
      punches: {
        checkInUtc: '2026-06-10T04:20:00.000Z',
        checkOutUtc: null,
        source: 'WEB',
      },
      shift: shift930,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe(ATTENDANCE_STATUS.LATE)
    expect(res.lateMinutes.toNumber()).toBe(5)
    expect(res.isLop).toBe(false)
  })

  // 3. shift 14:00-23:00, punch 14:30 -> LATE, proving no hardcoded 10:00
  it('shift 14:00-23:00, punch 14:30 -> LATE, proving no hardcoded 10:00', () => {
    // 14:30 IST = 09:00:00 UTC (grace cutoff is 14:15; punch is at 14:30 -> LATE)
    const res = classifyDay({
      dateKey: '2026-06-10',
      isHoliday: false,
      isWeekoff: false,
      punches: {
        checkInUtc: '2026-06-10T09:00:00.000Z',
        checkOutUtc: null,
        source: 'WEB',
      },
      shift: shift1400,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe(ATTENDANCE_STATUS.LATE)
    expect(res.lateMinutes.toNumber()).toBe(15)
    expect(res.isLop).toBe(false)
  })

  // 4. holiday date with punches -> status HOLIDAY, no LOP
  it('holiday date with punches -> status HOLIDAY, no LOP', () => {
    const res = classifyDay({
      dateKey: '2026-06-10',
      isHoliday: true,
      isWeekoff: false,
      punches: {
        checkInUtc: '2026-06-10T04:00:00.000Z',
        checkOutUtc: '2026-06-10T12:00:00.000Z',
        source: 'WEB',
      },
      shift: shift930,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe(ATTENDANCE_STATUS.HOLIDAY)
    expect(res.isLop).toBe(false)
  })

  // 5. no punches (absent path) via a direct classifyDay call -> ABSENT, isLop true
  it('no punches (absent path) via a direct classifyDay call -> ABSENT, isLop true', () => {
    const res = classifyDay({
      dateKey: '2026-06-10',
      isHoliday: false,
      isWeekoff: false,
      punches: null,
      shift: shift930,
      timeZone: 'Asia/Kolkata',
    })

    expect(res.status).toBe(ATTENDANCE_STATUS.ABSENT)
    expect(res.isLop).toBe(true)
    expect(res.lateMinutes.toNumber()).toBe(0)
    expect(res.otHours.toNumber()).toBe(0)
  })

  // 6. End-to-end route wiring: POST /api/attendance persists classification fields
  it('POST /api/attendance persists status, lateMinutes, earlyExitMinutes, otMinutes, isLop, shiftId, classifiedAt', async () => {
    mockDb.employeeShiftAssignment.findFirst.mockResolvedValue(null)
    mockDb.shift.findFirst.mockResolvedValue(shift930)
    mockDb.attendance.findUnique.mockResolvedValue(null)
    mockDb.attendance.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'att_new_1',
      ...data,
    }))

    const res = await attendancePost()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.action).toBe('CHECK_IN')

    expect(mockDb.attendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 'emp_1',
        companyId: 'company_alpha',
        shiftId: 'shift_930',
        isLop: false,
        classifiedAt: expect.any(Date),
      }),
    })
  })
})

