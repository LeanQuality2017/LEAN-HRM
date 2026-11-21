import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ROLES, ATTENDANCE_STATUS, PAYROLL_STATUS } from '@/lib/constants'
import type { AuthContext } from '@/lib/api-auth'
import {
  POST as submitRegularisation,
  GET as listRegularisations,
} from '@/app/api/attendance/regularisation/route'
import {
  PATCH as reviewRegularisation,
  GET as getRegularisation,
} from '@/app/api/attendance/regularisation/[id]/route'

// -------------------------------------------------------------
// Hoisted Mock Setup (Vitest Hoisting Safe, Zero 'any')
// -------------------------------------------------------------
const { mockDb, getAuthContext, setAuthContext, getScopedIds, setScopedIds } = vi.hoisted(() => {
  let currentAuth: AuthContext | null = null
  let scopedCompanyIds: string[] | null = null

  interface TransactionCallback<T> {
    (tx: typeof db): Promise<T>
  }

  const db = {
    employee: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    employeeCompanyAssignment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    companyPayRule: {
      findUnique: vi.fn(),
    },
    payroll: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    attendance: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    attendanceRegularisation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
            role: ctx.role || ROLES.EMPLOYEE,
            employeeId: ctx.employeeId !== undefined ? ctx.employeeId : 'emp_1',
            name: ctx.name || 'Test User',
          } as AuthContext)
        : null
    },
    getScopedIds: () => scopedCompanyIds,
    setScopedIds: (ids: string[] | null) => {
      scopedCompanyIds = ids
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
        throw new actual.ApiError(403, 'Forbidden: insufficient permissions')
      }
      return auth
    }),
    getScopedCompanyIds: vi.fn(async () => {
      return getScopedIds()
    }),
  }
})

// Mock audit log to prevent external side-effects
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue({ id: 'audit_test_id' }),
}))

describe('WO-ATT-REG: Attendance Regularisation / Missed Punch Workflow', () => {
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

  function createJsonRequest(url: string, method: string, body?: unknown): Request {
    return new Request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  // Calculate dynamic date relative to current time
  const now = new Date()
  const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0]
  const twoDaysAgo = new Date(now.getTime() - 2 * 86400000)
  const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0]
  const fortyDaysAgo = new Date(now.getTime() - 40 * 86400000)
  const fortyDaysAgoStr = fortyDaysAgo.toISOString().split('T')[0]

  beforeEach(() => {
    vi.clearAllMocks()

    // Default Auth: Employee in company_alpha
    setAuthContext({
      userId: 'user_emp_1',
      role: ROLES.EMPLOYEE,
      employeeId: 'emp_1',
    })
    setScopedIds(['company_alpha'])

    mockDb.employeeCompanyAssignment.findFirst.mockResolvedValue({
      id: 'eca_1',
      companyId: 'company_alpha',
      employeeId: 'emp_1',
      isPrimary: true,
    })
    mockDb.employeeCompanyAssignment.findMany.mockResolvedValue([
      { companyId: 'company_alpha', isPrimary: true },
    ])
    mockDb.companyPayRule.findUnique.mockResolvedValue({
      timezone: 'Asia/Kolkata',
      regularisationWindowDays: 30,
    })
    mockDb.payroll.findFirst.mockResolvedValue(null)
    mockDb.attendanceRegularisation.findFirst.mockResolvedValue(null)
    mockDb.employeeShiftAssignment.findFirst.mockResolvedValue(null)
    mockDb.shift.findFirst.mockResolvedValue(shift930)
    mockDb.holiday.findUnique.mockResolvedValue(null)
    mockDb.attendance.findUnique.mockResolvedValue(null)

    mockDb.attendanceRegularisation.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'reg_100',
      ...args.data,
      createdAt: new Date(),
    }))

    mockDb.attendanceRegularisation.update.mockImplementation(
      async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: args.where.id,
        employeeId: 'emp_1',
        companyId: 'company_alpha',
        date: new Date(`${twoDaysAgoStr}T00:00:00.000Z`),
        requestedCheckIn: new Date(`${twoDaysAgoStr}T04:00:00.000Z`),
        requestedCheckOut: new Date(`${twoDaysAgoStr}T13:00:00.000Z`),
        ...args.data,
      })
    )

    mockDb.attendance.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
      id: 'att_upserted_1',
      ...args.create,
    }))
  })

  // 1. HAPPY PATH: Employee submits within window -> Manager approves -> Attendance recalculated & audit logged
  it('1. Happy path: Employee submits within window, Manager approves, attendance recalculated with audit log', async () => {
    // Step A: Employee submits
    const submitReq = createJsonRequest('http://localhost:3001/api/attendance/regularisation', 'POST', {
      companyId: 'company_alpha',
      workDate: twoDaysAgoStr,
      intendedCheckIn: `${twoDaysAgoStr}T04:00:00.000Z`, // 09:30 IST
      intendedCheckOut: `${twoDaysAgoStr}T13:00:00.000Z`, // 18:30 IST
      reason: 'Biometric device scanner was unresponsive at front gate',
    })

    const submitRes = await submitRegularisation(submitReq)
    expect(submitRes.status).toBe(201)
    const submitJson = (await submitRes.json()) as { ok: boolean; data: { id: string; status: string } }
    expect(submitJson.ok).toBe(true)
    expect(submitJson.data.status).toBe('PENDING')
    expect(mockDb.attendanceRegularisation.create).toHaveBeenCalledTimes(1)

    // Step B: Manager approves
    setAuthContext({
      userId: 'user_mgr_1',
      role: ROLES.MANAGER,
      employeeId: 'emp_mgr_1',
    })
    setScopedIds(['company_alpha'])

    mockDb.attendanceRegularisation.findUnique.mockResolvedValue({
      id: 'reg_100',
      employeeId: 'emp_1',
      companyId: 'company_alpha',
      date: new Date(`${twoDaysAgoStr}T00:00:00.000Z`),
      requestedCheckIn: new Date(`${twoDaysAgoStr}T04:00:00.000Z`),
      requestedCheckOut: new Date(`${twoDaysAgoStr}T13:00:00.000Z`),
      reason: 'Biometric device scanner was unresponsive at front gate',
      status: 'PENDING',
      employee: {
        id: 'emp_1',
        employeeCode: 'EMP-001',
        managerId: 'emp_mgr_1',
      },
    })

    const reviewReq = createJsonRequest(
      'http://localhost:3001/api/attendance/regularisation/reg_100',
      'PATCH',
      {
        action: 'APPROVE',
        reviewComment: 'Verified with security desk check-in log. Approved.',
      }
    )

    const reviewRes = await reviewRegularisation(reviewReq, {
      params: Promise.resolve({ id: 'reg_100' }),
    })

    expect(reviewRes.status).toBe(200)
    const reviewJson = (await reviewRes.json()) as {
      ok: boolean
      data: {
        request: { status: string; reviewedById: string }
        attendance: { status: string; source: string; lateMinutes: number }
      }
    }
    expect(reviewJson.ok).toBe(true)
    expect(reviewJson.data.request.status).toBe('APPROVED')

    // Attendance is recalculated by classification engine: 09:30 on 09:30 shift -> PRESENT, lateMinutes 0
    expect(reviewJson.data.attendance.status).toBe(ATTENDANCE_STATUS.PRESENT)
    expect(reviewJson.data.attendance.source).toBe('REGULARISATION')
    expect(reviewJson.data.attendance.lateMinutes).toBe(0)

    // Verify AuditLog entry was appended with before/after status
    const { logAudit } = await import('@/lib/audit')
    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      'user_mgr_1',
      'REGULARISATION_APPROVE',
      'AttendanceRegularisation',
      'reg_100',
      expect.objectContaining({
        requestId: 'reg_100',
        approverId: 'user_mgr_1',
        beforeStatus: ATTENDANCE_STATUS.ABSENT,
        afterStatus: ATTENDANCE_STATUS.PRESENT,
      })
    )
  })

  // 2. OD-A1: OUT-OF-WINDOW REJECTION (FIXED 30 DAYS PER OWNER RULING 10B)
  it('2. Out-of-window rejection (OD-A1): Request for date older than 30 days returns 400', async () => {
    // 40 days ago is beyond the 30-day window
    const req = createJsonRequest('http://localhost:3001/api/attendance/regularisation', 'POST', {
      companyId: 'company_alpha',
      workDate: fortyDaysAgoStr,
      reason: 'Forgot to punch 40 days ago',
    })

    const res = await submitRegularisation(req)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/Regularisation window expired: requests must be within 30 days/)
    expect(mockDb.attendanceRegularisation.create).not.toHaveBeenCalled()
  })

  // 3. OD-A3: PAYROLL-LOCKED REJECTION
  it('3. Payroll-locked rejection (OD-A3): Request for month with locked/processed payroll returns 400', async () => {
    // Mock payroll record in LOCKED status for that month/year
    mockDb.payroll.findFirst.mockResolvedValue({
      id: 'pr_locked_1',
      employeeId: 'emp_1',
      month: twoDaysAgo.getUTCMonth() + 1,
      year: twoDaysAgo.getUTCFullYear(),
      status: PAYROLL_STATUS.LOCKED,
    })

    const req = createJsonRequest('http://localhost:3001/api/attendance/regularisation', 'POST', {
      companyId: 'company_alpha',
      workDate: twoDaysAgoStr,
      reason: 'Late missed punch submission',
    })

    const res = await submitRegularisation(req)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/Cannot regularise attendance: payroll for .* is locked or already processed/)
    expect(mockDb.attendanceRegularisation.create).not.toHaveBeenCalled()
  })

  // 4. OD-A5: DUPLICATE REJECTION
  it('4. Duplicate rejection (OD-A5): Duplicate request for same employee and date returns 409', async () => {
    // Mock existing pending request on that date
    mockDb.attendanceRegularisation.findFirst.mockResolvedValue({
      id: 'reg_existing_1',
      employeeId: 'emp_1',
      companyId: 'company_alpha',
      date: new Date(`${twoDaysAgoStr}T00:00:00.000Z`),
      status: 'PENDING',
    })

    const req = createJsonRequest('http://localhost:3001/api/attendance/regularisation', 'POST', {
      companyId: 'company_alpha',
      workDate: twoDaysAgoStr,
      reason: 'Submitting duplicate request',
    })

    const res = await submitRegularisation(req)
    expect(res.status).toBe(409)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('A regularisation request already exists for this date')
    expect(mockDb.attendanceRegularisation.create).not.toHaveBeenCalled()
  })

  // 5. CROSS-COMPANY APPROVAL ATTEMPT (MUST FAIL)
  it('5. Cross-company approval attempt (must fail): Manager of ALPHA cannot approve BETA regularisation (403)', async () => {
    // Manager has scope ONLY for company_alpha
    setAuthContext({
      userId: 'user_mgr_alpha',
      role: ROLES.COMPANY_ADMIN,
    })
    setScopedIds(['company_alpha'])

    // Request belongs to company_beta
    mockDb.attendanceRegularisation.findUnique.mockResolvedValue({
      id: 'reg_beta_1',
      employeeId: 'emp_beta_1',
      companyId: 'company_beta',
      date: new Date(`${twoDaysAgoStr}T00:00:00.000Z`),
      status: 'PENDING',
      employee: {
        id: 'emp_beta_1',
        employeeCode: 'BETA-001',
        managerId: null,
      },
    })

    const req = createJsonRequest(
      'http://localhost:3001/api/attendance/regularisation/reg_beta_1',
      'PATCH',
      {
        action: 'APPROVE',
        reviewComment: 'Cross-tenant illegal approval',
      }
    )

    const res = await reviewRegularisation(req, {
      params: Promise.resolve({ id: 'reg_beta_1' }),
    })

    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('Forbidden: company out of scope')
    expect(mockDb.attendanceRegularisation.update).not.toHaveBeenCalled()
    expect(mockDb.attendance.upsert).not.toHaveBeenCalled()
  })

  // 6. NON-MANAGER APPROVAL ATTEMPT (MUST FAIL)
  it('6. Non-manager approval attempt (must fail): EMPLOYEE role calling approval route returns 403', async () => {
    // Standard employee (EMPLOYEE role)
    setAuthContext({
      userId: 'user_emp_1',
      role: ROLES.EMPLOYEE,
      employeeId: 'emp_1',
    })
    setScopedIds(['company_alpha'])

    const req = createJsonRequest(
      'http://localhost:3001/api/attendance/regularisation/reg_100',
      'PATCH',
      {
        action: 'APPROVE',
      }
    )

    const res = await reviewRegularisation(req, {
      params: Promise.resolve({ id: 'reg_100' }),
    })

    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('Forbidden: insufficient permissions')
    expect(mockDb.attendanceRegularisation.findUnique).not.toHaveBeenCalled()
    expect(mockDb.attendanceRegularisation.update).not.toHaveBeenCalled()
  })

  // 7. MANAGER SELF-APPROVAL ATTEMPT (MUST FAIL 403)
  it('7. Manager self-approval attempt (must fail 403): Manager cannot approve their own regularisation', async () => {
    // Current user is MANAGER attempting to review their own regularisation request
    setAuthContext({
      userId: 'user_mgr_1',
      role: ROLES.MANAGER,
      employeeId: 'emp_mgr_1',
    })
    setScopedIds(['company_alpha'])

    mockDb.attendanceRegularisation.findUnique.mockResolvedValue({
      id: 'reg_mgr_own',
      employeeId: 'emp_mgr_1', // same as approver's employeeId
      companyId: 'company_alpha',
      date: new Date(`${twoDaysAgoStr}T00:00:00.000Z`),
      requestedCheckIn: new Date(`${twoDaysAgoStr}T04:00:00.000Z`),
      requestedCheckOut: new Date(`${twoDaysAgoStr}T13:00:00.000Z`),
      status: 'PENDING',
      employee: {
        id: 'emp_mgr_1',
        employeeCode: 'MGR-001',
        managerId: null,
        userId: 'user_mgr_1',
        user: { id: 'user_mgr_1', role: ROLES.MANAGER },
      },
    })

    const req = createJsonRequest(
      'http://localhost:3001/api/attendance/regularisation/reg_mgr_own',
      'PATCH',
      {
        action: 'APPROVE',
        reviewComment: 'Self-approval attempt by manager',
      }
    )

    const res = await reviewRegularisation(req, {
      params: Promise.resolve({ id: 'reg_mgr_own' }),
    })

    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('Forbidden: self-approval is not permitted')
    expect(mockDb.attendanceRegularisation.update).not.toHaveBeenCalled()
    expect(mockDb.attendance.upsert).not.toHaveBeenCalled()
  })

  // 8. HR APPROVING OWN REQUEST (MUST FAIL 403 UNLESS SUPER_ADMIN)
  it('8. HR approving own request: fails with 403 for HR; succeeds with 200 for SUPER_ADMIN', async () => {
    const hrRequest = {
      id: 'reg_hr_own',
      employeeId: 'emp_hr_1',
      companyId: 'company_alpha',
      date: new Date(`${twoDaysAgoStr}T00:00:00.000Z`),
      requestedCheckIn: new Date(`${twoDaysAgoStr}T04:00:00.000Z`),
      requestedCheckOut: new Date(`${twoDaysAgoStr}T13:00:00.000Z`),
      status: 'PENDING',
      employee: {
        id: 'emp_hr_1',
        employeeCode: 'HR-001',
        managerId: null,
        userId: 'user_hr_1',
        user: { id: 'user_hr_1', role: ROLES.HR },
      },
    }

    mockDb.attendanceRegularisation.findUnique.mockResolvedValue(hrRequest)

    // Part A: HR attempts self-approval -> 403
    setAuthContext({
      userId: 'user_hr_1',
      role: ROLES.HR,
      employeeId: 'emp_hr_1',
    })
    setScopedIds(['company_alpha'])

    const reqHrSelf = createJsonRequest(
      'http://localhost:3001/api/attendance/regularisation/reg_hr_own',
      'PATCH',
      { action: 'APPROVE', reviewComment: 'HR self-approving' }
    )

    const resHrSelf = await reviewRegularisation(reqHrSelf, {
      params: Promise.resolve({ id: 'reg_hr_own' }),
    })

    expect(resHrSelf.status).toBe(403)
    const jsonHrSelf = (await resHrSelf.json()) as { error: string }
    expect(jsonHrSelf.error).toContain('Forbidden: self-approval is not permitted')
    expect(mockDb.attendanceRegularisation.update).not.toHaveBeenCalled()

    // Part B: SUPER_ADMIN approves HR's request -> 200 OK
    setAuthContext({
      userId: 'user_super_admin',
      role: ROLES.SUPER_ADMIN,
      employeeId: undefined,
    })
    setScopedIds(null) // Super admin has global scope

    const reqSuperAdmin = createJsonRequest(
      'http://localhost:3001/api/attendance/regularisation/reg_hr_own',
      'PATCH',
      { action: 'APPROVE', reviewComment: 'Super Admin approved HR regularisation' }
    )

    const resSuperAdmin = await reviewRegularisation(reqSuperAdmin, {
      params: Promise.resolve({ id: 'reg_hr_own' }),
    })

    expect(resSuperAdmin.status).toBe(200)
    const jsonSuperAdmin = (await resSuperAdmin.json()) as { ok: boolean }
    expect(jsonSuperAdmin.ok).toBe(true)
    expect(mockDb.attendanceRegularisation.update).toHaveBeenCalled()
  })

  // 9. HR APPROVING MANAGER'S REQUEST (ESCALATION CHAIN: 200 OK)
  it('9. Manager request approved by HR of their company succeeds (200 OK)', async () => {
    // Request belongs to a MANAGER
    mockDb.attendanceRegularisation.findUnique.mockResolvedValue({
      id: 'reg_mgr_request',
      employeeId: 'emp_mgr_1',
      companyId: 'company_alpha',
      date: new Date(`${twoDaysAgoStr}T00:00:00.000Z`),
      requestedCheckIn: new Date(`${twoDaysAgoStr}T04:00:00.000Z`),
      requestedCheckOut: new Date(`${twoDaysAgoStr}T13:00:00.000Z`),
      status: 'PENDING',
      employee: {
        id: 'emp_mgr_1',
        employeeCode: 'MGR-001',
        managerId: null,
        userId: 'user_mgr_1',
        user: { id: 'user_mgr_1', role: ROLES.MANAGER },
      },
    })

    // Reviewer is HR of company_alpha
    setAuthContext({
      userId: 'user_hr_alpha',
      role: ROLES.HR,
      employeeId: 'emp_hr_alpha',
    })
    setScopedIds(['company_alpha'])

    const req = createJsonRequest(
      'http://localhost:3001/api/attendance/regularisation/reg_mgr_request',
      'PATCH',
      { action: 'APPROVE', reviewComment: 'HR approved manager request' }
    )

    const res = await reviewRegularisation(req, {
      params: Promise.resolve({ id: 'reg_mgr_request' }),
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean }
    expect(json.ok).toBe(true)
    expect(mockDb.attendanceRegularisation.update).toHaveBeenCalled()
  })

  // 10. TEAM_LEAD REQUESTER TREATED IDENTICAL TO EMPLOYEE (Owner ruling 5A)
  it('10. TEAM_LEAD requester treated as STAFF-level: approved by Manager of their company (200 OK)', async () => {
    // Request belongs to a TEAM_LEAD reporting to emp_mgr_1
    mockDb.attendanceRegularisation.findUnique.mockResolvedValue({
      id: 'reg_team_lead_request',
      employeeId: 'emp_tl_1',
      companyId: 'company_alpha',
      date: new Date(`${twoDaysAgoStr}T00:00:00.000Z`),
      requestedCheckIn: new Date(`${twoDaysAgoStr}T04:00:00.000Z`),
      requestedCheckOut: new Date(`${twoDaysAgoStr}T13:00:00.000Z`),
      status: 'PENDING',
      employee: {
        id: 'emp_tl_1',
        employeeCode: 'TL-001',
        managerId: 'emp_mgr_1',
        userId: 'user_tl_1',
        user: { id: 'user_tl_1', role: 'TEAM_LEAD' },
      },
    })

    // Reviewer is Manager of company_alpha
    setAuthContext({
      userId: 'user_mgr_1',
      role: ROLES.MANAGER,
      employeeId: 'emp_mgr_1',
    })
    setScopedIds(['company_alpha'])

    const req = createJsonRequest(
      'http://localhost:3001/api/attendance/regularisation/reg_team_lead_request',
      'PATCH',
      { action: 'APPROVE', reviewComment: 'Manager approved Team Lead request' }
    )

    const res = await reviewRegularisation(req, {
      params: Promise.resolve({ id: 'reg_team_lead_request' }),
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean }
    expect(json.ok).toBe(true)
    expect(mockDb.attendanceRegularisation.update).toHaveBeenCalled()
  })
})

