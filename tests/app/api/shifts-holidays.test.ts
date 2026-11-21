import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ROLES } from '@/lib/constants'
import type { AuthContext } from '@/lib/api-auth'
import { POST as postShift, GET as getShifts } from '@/app/api/shifts/route'
import {
  GET as getShiftById,
  PATCH as patchShift,
  DELETE as deleteShift,
} from '@/app/api/shifts/[id]/route'
import { POST as postHoliday, GET as getHolidays } from '@/app/api/holidays/route'
import {
  GET as getHolidayById,
  PATCH as patchHoliday,
  DELETE as deleteHoliday,
} from '@/app/api/holidays/[id]/route'

// -------------------------------------------------------------
// Hoisted Mock Setup (Type-Safe, Zero 'any')
// -------------------------------------------------------------
const { mockDb, getAuthContext, setAuthContext, getScopedIds, setScopedIds } = vi.hoisted(() => {
  let currentAuth: AuthContext | null = null
  let scopedIds: string[] | null = null

  interface TransactionCallback<T> {
    (tx: typeof db): Promise<T>
  }

  const db = {
    company: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    shift: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    employeeShiftAssignment: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    holiday: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit_test_id' }),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async <T>(cb: TransactionCallback<T>): Promise<T> => cb(db)),
  }

  return {
    mockDb: db,
    getAuthContext: () => currentAuth,
    setAuthContext: (ctx: Partial<AuthContext> | null) => {
      currentAuth = ctx
        ? ({
            userId: ctx.userId || 'test_user_id',
            role: ctx.role || ROLES.HR,
            employeeId: ctx.employeeId !== undefined ? ctx.employeeId : 'emp_test_id',
            name: ctx.name || 'Test User',
          } as AuthContext)
        : null
    },
    getScopedIds: () => scopedIds,
    setScopedIds: (ids: string[] | null) => {
      scopedIds = ids
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
    getScopedCompanyIds: vi.fn(async () => {
      return getScopedIds()
    }),
  }
})

// Mock audit log to prevent unneeded side effects
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue({ id: 'audit_test_id' }),
}))

describe('Shifts and Holidays Configuration API (Step 4.6)', () => {
  const companyAlpha = { id: 'company_alpha', name: 'Alpha Tech', code: 'ALPHA' }
  const companyBeta = { id: 'company_beta', name: 'Beta Solutions', code: 'BETA' }

  function createJsonRequest(url: string, method: string, body?: unknown): Request {
    return new Request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Default: Super Admin with global scope
    setAuthContext({
      userId: 'admin_1',
      role: ROLES.SUPER_ADMIN,
    })
    setScopedIds(null)

    mockDb.company.findUnique.mockResolvedValue(companyAlpha)
    mockDb.shift.updateMany.mockResolvedValue({ count: 1 })
    mockDb.shift.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'shift_created_1',
      ...args.data,
      createdAt: new Date(),
    }))
    mockDb.shift.update.mockImplementation(
      async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: args.where.id,
        ...args.data,
        createdAt: new Date(),
      })
    )
    mockDb.shift.delete.mockResolvedValue({ id: 'shift_1' })
    mockDb.employeeShiftAssignment.count.mockResolvedValue(0)

    mockDb.holiday.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'hol_created_1',
      ...args.data,
    }))
    mockDb.holiday.update.mockImplementation(
      async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: args.where.id,
        ...args.data,
      })
    )
    mockDb.holiday.delete.mockResolvedValue({ id: 'hol_1' })
  })

  // 1. POST shift with startTime "9:30" (unpadded) -> 400, only "09:30" accepted
  it('POST shift with startTime "9:30" (unpadded) -> 400, only "09:30" accepted', async () => {
    // Unpadded "9:30" should fail validation
    const unpaddedReq = createJsonRequest('http://localhost:3001/api/shifts', 'POST', {
      companyId: 'company_alpha',
      name: 'Morning Shift',
      startTime: '9:30',
      endTime: '18:30',
    })
    const unpaddedRes = await postShift(unpaddedReq)
    expect(unpaddedRes.status).toBe(400)
    const unpaddedJson = (await unpaddedRes.json()) as { error: string }
    expect(unpaddedJson.error).toContain('startTime')

    // Padded "09:30" should succeed
    const validReq = createJsonRequest('http://localhost:3001/api/shifts', 'POST', {
      companyId: 'company_alpha',
      name: 'Morning Shift',
      startTime: '09:30',
      endTime: '18:30',
    })
    const validRes = await postShift(validReq)
    expect(validRes.status).toBe(201)
    const validJson = (await validRes.json()) as { ok: boolean; data: { startTime: string } }
    expect(validJson.ok).toBe(true)
    expect(validJson.data.startTime).toBe('09:30')
  })

  // 1b. Reject endTime === startTime
  it('POST shift rejects endTime === startTime with 400', async () => {
    const req = createJsonRequest('http://localhost:3001/api/shifts', 'POST', {
      companyId: 'company_alpha',
      name: 'Zero Duration Shift',
      startTime: '09:30',
      endTime: '09:30',
    })
    const res = await postShift(req)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('endTime')
  })

  // 2. Second shift with isDefault=true unsets the first (assert the update call)
  it('Second shift with isDefault=true unsets the first (assert the update call)', async () => {
    const req = createJsonRequest('http://localhost:3001/api/shifts', 'POST', {
      companyId: 'company_alpha',
      name: 'New Default Night Shift',
      startTime: '22:00',
      endTime: '06:00',
      isDefault: true,
    })
    const res = await postShift(req)
    expect(res.status).toBe(201)

    // Assert that updateMany was called inside the transaction to unset previous default
    expect(mockDb.shift.updateMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company_alpha',
        isDefault: true,
      },
      data: {
        isDefault: false,
      },
    })

    // Assert create was called with isDefault: true
    expect(mockDb.shift.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company_alpha',
        name: 'New Default Night Shift',
        isDefault: true,
      }),
    })
  })

  // 2b. POST shift with nonexistent companyId returns 400 Bad Request via P2003 mapping
  it('POST shift with nonexistent companyId returns 400 Bad Request via P2003 mapping', async () => {
    const { Prisma } = await import('@prisma/client')
    mockDb.shift.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed on the field: (`companyId`)', {
        code: 'P2003',
        clientVersion: '6.19.3',
      })
    )

    const req = createJsonRequest('http://localhost:3001/api/shifts', 'POST', {
      companyId: 'nonexistent_company_id',
      name: 'Orphan Shift',
      startTime: '09:00',
      endTime: '17:00',
    })
    const res = await postShift(req)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Invalid reference: related record does not exist')
  })

  // 3. HR of ALPHA creates holiday for BETA -> 403
  it('HR of ALPHA creates holiday for BETA -> 403', async () => {
    // Configure auth context: HR scoped ONLY to company_alpha
    setAuthContext({
      userId: 'hr_alpha_1',
      role: ROLES.HR,
      employeeId: 'emp_hr_alpha',
    })
    setScopedIds(['company_alpha'])

    const req = createJsonRequest('http://localhost:3001/api/holidays', 'POST', {
      companyId: 'company_beta',
      date: '2026-08-15',
      name: 'Independence Day',
    })
    const res = await postHoliday(req)

    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('Forbidden: company out of scope')
    expect(mockDb.holiday.create).not.toHaveBeenCalled()
  })

  // 4. DELETE shift referenced by an assignment -> 400
  it('DELETE shift referenced by an assignment -> 400', async () => {
    mockDb.shift.findUnique.mockResolvedValue({
      id: 'shift_assigned_1',
      companyId: 'company_alpha',
      name: 'General Shift',
      startTime: '09:30',
      endTime: '18:30',
    })

    // EmployeeShiftAssignment count is 2 (shift is in use)
    mockDb.employeeShiftAssignment.count.mockResolvedValue(2)

    const req = createJsonRequest('http://localhost:3001/api/shifts/shift_assigned_1', 'DELETE')
    const res = await deleteShift(req, { params: Promise.resolve({ id: 'shift_assigned_1' }) })

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('assigned to employees')
    expect(mockDb.shift.delete).not.toHaveBeenCalled()
  })

  // 4b. DELETE shift with zero assignments -> 200
  it('DELETE shift with zero assignments succeeds with 200', async () => {
    mockDb.shift.findUnique.mockResolvedValue({
      id: 'shift_unassigned_1',
      companyId: 'company_alpha',
      name: 'Temporary Shift',
      startTime: '10:00',
      endTime: '19:00',
    })
    mockDb.employeeShiftAssignment.count.mockResolvedValue(0)

    const req = createJsonRequest('http://localhost:3001/api/shifts/shift_unassigned_1', 'DELETE')
    const res = await deleteShift(req, { params: Promise.resolve({ id: 'shift_unassigned_1' }) })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; message: string }
    expect(json.ok).toBe(true)
    expect(mockDb.shift.delete).toHaveBeenCalledWith({
      where: { id: 'shift_unassigned_1' },
    })
  })

  // 5. GET holidays filtered by year returns only that year
  it('GET holidays filtered by year returns only that year', async () => {
    const holidays2026 = [
      { id: 'hol_1', companyId: 'company_alpha', date: new Date('2026-01-26T00:00:00.000Z'), name: 'Republic Day' },
      { id: 'hol_2', companyId: 'company_alpha', date: new Date('2026-08-15T00:00:00.000Z'), name: 'Independence Day' },
    ]
    mockDb.holiday.findMany.mockResolvedValue(holidays2026)

    const req = new Request('http://localhost:3001/api/holidays?companyId=company_alpha&year=2026')
    const res = await getHolidays(req)

    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      ok: boolean
      data: Array<{ id: string; companyId: string; date: string; name: string }>
    }
    expect(json.ok).toBe(true)
    expect(json.data).toEqual([
      { id: 'hol_1', companyId: 'company_alpha', date: '2026-01-26T00:00:00.000Z', name: 'Republic Day' },
      { id: 'hol_2', companyId: 'company_alpha', date: '2026-08-15T00:00:00.000Z', name: 'Independence Day' },
    ])

    expect(mockDb.holiday.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company_alpha',
        date: {
          gte: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
          lte: new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999)),
        },
      },
      orderBy: { date: 'asc' },
    })
  })
})
