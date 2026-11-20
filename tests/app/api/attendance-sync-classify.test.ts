import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { POST as syncPost } from '@/app/api/attendance/sync/route'
import { ATTENDANCE_STATUS } from '@/lib/constants'

// -------------------------------------------------------------
// Hoisted Mock Setup (Type-Safe, Zero 'any')
// -------------------------------------------------------------
const { mockDb } = vi.hoisted(() => {
  interface TransactionCallback<T> {
    (tx: typeof db): Promise<T>
  }

  const db = {
    employee: {
      findUnique: vi.fn(),
    },
    employeeCompanyAssignment: {
      findMany: vi.fn(),
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
    user: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit_test_id' }),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async <T>(cb: TransactionCallback<T>): Promise<T> => cb(db)),
  }

  return { mockDb: db }
})

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

// Mock audit log to prevent unneeded side effects
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue({ id: 'audit_test_id' }),
}))

describe('Biometric Sync Attendance Classification Wiring (Step 4.5)', () => {
  const TEST_API_KEY = 'test-secret-biometric-key'

  const shift930 = {
    id: 'shift_930',
    companyId: 'company_alpha',
    name: 'General Morning Shift',
    startTime: '09:30',
    endTime: '18:30',
    breakMinutes: 60,
    graceMinutes: 15,
    weekoffMultiplier: new Prisma.Decimal('2.00'),
    isDefault: true,
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
    isDefault: true,
  }

  const defaultEmployee = {
    id: 'emp_1',
    employeeCode: 'EMP001',
    assignments: [{ companyId: 'company_alpha' }],
  }

  function createSyncRequest(body: unknown, apiKey = TEST_API_KEY): Request {
    return new Request('http://localhost:3001/api/attendance/sync', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BIOMETRIC_API_KEY = TEST_API_KEY

    // Default DB mock behaviors
    mockDb.employee.findUnique.mockResolvedValue(defaultEmployee)
    mockDb.employeeCompanyAssignment.findMany.mockResolvedValue([
      { companyId: 'company_alpha', isPrimary: true },
    ])
    mockDb.companyPayRule.findUnique.mockResolvedValue({
      timezone: 'Asia/Kolkata',
    })
    mockDb.holiday.findUnique.mockResolvedValue(null)
    mockDb.attendance.findUnique.mockResolvedValue(null)
    mockDb.attendance.create.mockResolvedValue({ id: 'att_created_id' })
    mockDb.attendance.update.mockResolvedValue({ id: 'att_updated_id' })
    mockDb.user.findFirst.mockResolvedValue({ id: 'super_admin_id' })
  })

  // 1. 14:00-23:00 shift, biometric punch 14:30 -> LATE with lateMinutes 15 (not 9:30 cutoff behavior)
  it('14:00-23:00 shift, biometric punch 14:30 -> LATE with lateMinutes 15, NOT the old 9:30 behavior', async () => {
    mockDb.employeeShiftAssignment.findFirst.mockResolvedValue(null)
    mockDb.shift.findFirst.mockResolvedValue(shift1400)

    // 14:30 IST on 2026-06-10 = 09:00:00 UTC
    // Shift is 14:00 with grace 15 min (threshold 14:15).
    // Punch at 14:30 -> 15 minutes late past grace.
    // Under old hardcoded 09:30 behavior, 14:30 would be 5 hours late.
    const res = await syncPost(
      createSyncRequest({
        punches: [
          {
            employeeCode: 'EMP001',
            date: '2026-06-10',
            checkIn: '2026-06-10T09:00:00.000Z',
          },
        ],
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { created: number; updated: number; skipped: number; errors: unknown[] }
    expect(json.created).toBe(1)
    expect(json.updated).toBe(0)
    expect(json.skipped).toBe(0)
    expect(json.errors).toHaveLength(0)

    expect(mockDb.attendance.create).toHaveBeenCalledTimes(1)
    const createCall = mockDb.attendance.create.mock.calls[0][0]
    expect(createCall.data.status).toBe(ATTENDANCE_STATUS.LATE)
    expect(createCall.data.lateMinutes).toBe(15)
    expect(createCall.data.isLop).toBe(false)
    expect(createCall.data.shiftId).toBe('shift_1400')
    expect(createCall.data.source).toBe('BIOMETRIC')
    expect(createCall.data.classifiedAt).toBeInstanceOf(Date)
  })

  // 2. 09:30 shift, punch 09:35, grace 15 -> PRESENT
  it('09:30 shift, punch 09:35, grace 15 -> PRESENT', async () => {
    mockDb.employeeShiftAssignment.findFirst.mockResolvedValue(null)
    mockDb.shift.findFirst.mockResolvedValue(shift930)

    // 09:35 IST on 2026-06-10 = 04:05:00 UTC
    // Shift is 09:30 with grace 15 min (cutoff 09:45).
    // Punch at 09:35 -> within grace -> PRESENT, lateMinutes: 0.
    const res = await syncPost(
      createSyncRequest({
        punches: [
          {
            employeeCode: 'EMP001',
            date: '2026-06-10',
            checkIn: '2026-06-10T04:05:00.000Z',
          },
        ],
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { created: number; updated: number; skipped: number; errors: unknown[] }
    expect(json.created).toBe(1)
    expect(json.errors).toHaveLength(0)

    expect(mockDb.attendance.create).toHaveBeenCalledTimes(1)
    const createCall = mockDb.attendance.create.mock.calls[0][0]
    expect(createCall.data.status).toBe(ATTENDANCE_STATUS.PRESENT)
    expect(createCall.data.lateMinutes).toBe(0)
    expect(createCall.data.isLop).toBe(false)
    expect(createCall.data.shiftId).toBe('shift_930')
  })

  // 3. biometric punch on a Holiday date -> HOLIDAY, isLop false
  it('biometric punch on a Holiday date -> HOLIDAY, isLop false', async () => {
    mockDb.employeeShiftAssignment.findFirst.mockResolvedValue(null)
    mockDb.shift.findFirst.mockResolvedValue(shift930)

    // Mark 2026-06-10 as a holiday
    mockDb.holiday.findUnique.mockResolvedValue({
      id: 'hol_1',
      companyId: 'company_alpha',
      date: new Date('2026-06-10T00:00:00.000Z'),
      name: 'Foundation Day',
    })

    const res = await syncPost(
      createSyncRequest({
        punches: [
          {
            employeeCode: 'EMP001',
            date: '2026-06-10',
            checkIn: '2026-06-10T04:00:00.000Z',
          },
        ],
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { created: number; updated: number; skipped: number; errors: unknown[] }
    expect(json.created).toBe(1)
    expect(json.errors).toHaveLength(0)

    expect(mockDb.attendance.create).toHaveBeenCalledTimes(1)
    const createCall = mockDb.attendance.create.mock.calls[0][0]
    expect(createCall.data.status).toBe(ATTENDANCE_STATUS.HOLIDAY)
    expect(createCall.data.isLop).toBe(false)
    expect(createCall.data.shiftId).toBe('shift_930')
  })

  // 4. company with no shift -> item lands in errors[], no attendance row written
  it('company with no shift -> item lands in errors[], no attendance row written', async () => {
    // Neither specific assignment nor default shift configured for company
    mockDb.employeeShiftAssignment.findFirst.mockResolvedValue(null)
    mockDb.shift.findFirst.mockResolvedValue(null)

    const res = await syncPost(
      createSyncRequest({
        punches: [
          {
            employeeCode: 'EMP001',
            date: '2026-06-10',
            checkIn: '2026-06-10T04:00:00.000Z',
          },
        ],
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      created: number
      updated: number
      skipped: number
      errors: Array<{ employeeCode: string; index: number; reason: string }>
    }

    expect(json.created).toBe(0)
    expect(json.updated).toBe(0)
    expect(json.skipped).toBe(1)
    expect(json.errors).toEqual([
      {
        employeeCode: 'EMP001',
        index: 0,
        reason: 'No shift configured for company',
      },
    ])

    // Verify no attendance write was performed
    expect(mockDb.attendance.create).not.toHaveBeenCalled()
    expect(mockDb.attendance.update).not.toHaveBeenCalled()
  })

  // 5. existing-record re-punch path updates classification fields
  it('existing-record re-punch path updates classification fields', async () => {
    mockDb.employeeShiftAssignment.findFirst.mockResolvedValue(null)
    mockDb.shift.findFirst.mockResolvedValue(shift930)

    const targetDate = new Date('2026-06-10T00:00:00.000Z')
    // Existing attendance record has checkIn only (09:30 IST)
    mockDb.attendance.findUnique.mockResolvedValue({
      id: 'att_existing_1',
      employeeId: 'emp_1',
      companyId: 'company_alpha',
      date: targetDate,
      checkIn: new Date('2026-06-10T04:00:00.000Z'), // 09:30 IST
      checkOut: null,
      status: ATTENDANCE_STATUS.PRESENT,
      lateMinutes: 0,
      earlyExitMinutes: 0,
      otMinutes: 0,
      isLop: false,
      shiftId: 'shift_930',
      source: 'BIOMETRIC',
    })

    // Biometric sync sends checkOut at 18:30 IST (13:00 UTC)
    const res = await syncPost(
      createSyncRequest({
        punches: [
          {
            employeeCode: 'EMP001',
            date: '2026-06-10',
            checkOut: '2026-06-10T13:00:00.000Z',
          },
        ],
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { created: number; updated: number; skipped: number; errors: unknown[] }
    expect(json.created).toBe(0)
    expect(json.updated).toBe(1)
    expect(json.skipped).toBe(0)
    expect(json.errors).toHaveLength(0)

    expect(mockDb.attendance.update).toHaveBeenCalledTimes(1)
    const updateCall = mockDb.attendance.update.mock.calls[0][0]
    expect(updateCall.where).toEqual({
      employeeId_companyId_date: {
        employeeId: 'emp_1',
        companyId: 'company_alpha',
        date: targetDate,
      },
    })
    expect(updateCall.data.checkOut).toEqual(new Date('2026-06-10T13:00:00.000Z'))
    expect(updateCall.data.status).toBe(ATTENDANCE_STATUS.PRESENT)
    expect(updateCall.data.lateMinutes).toBe(0)
    expect(updateCall.data.earlyExitMinutes).toBe(0)
    expect(updateCall.data.otMinutes).toBe(0)
    expect(updateCall.data.isLop).toBe(false)
    expect(updateCall.data.shiftId).toBe('shift_930')
    expect(updateCall.data.classifiedAt).toBeInstanceOf(Date)
  })
})

