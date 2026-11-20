import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { ROLES, LEAVE_STATUS } from '@/lib/constants'
import type { AuthContext } from '@/lib/api-auth'
import { POST as applyLeave } from '@/app/api/leaves/route'
import { PATCH as updateLeave } from '@/app/api/leaves/[id]/route'
import { GET as getLeaveBalance } from '@/app/api/leaves/balance/route'

// -------------------------------------------------------------
// Hoisted Mock Setup (Vitest Hoisting Safe)
// -------------------------------------------------------------
const { mockDb, getAuthContext, setAuthContext } = vi.hoisted(() => {
  let currentAuth: AuthContext | null = null

  const db = {
    employee: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    leaveType: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    leaveBalance: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    leaveRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    attendance: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    employeeCompanyAssignment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    userCompanyScope: {
      findMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit_test_id' }),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(db)),
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

describe('Leave Balance Enforcement & Management (Spec 5.a–5.h)', () => {
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const tomorrow = new Date(today.getTime() + 86400000)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  const dayAfter = new Date(today.getTime() + 2 * 86400000)
  const dayAfterStr = dayAfter.toISOString().split('T')[0]

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (cb: any) => cb(mockDb))
    mockDb.employeeCompanyAssignment.findMany.mockResolvedValue([{ companyId: 'company_alpha' }])
    mockDb.userCompanyScope.findMany.mockResolvedValue([{ companyId: 'company_alpha' }])
  })

  it('5.a: Apply within balance -> 201, used not yet incremented (pending only)', async () => {
    setAuthContext({
      userId: 'user_emp_1',
      role: ROLES.EMPLOYEE,
      employeeId: 'emp_1',
    })

    mockDb.leaveType.findFirst.mockResolvedValue({
      id: 'lt_annual',
      name: 'Annual Leave',
      companyId: 'company_alpha',
      isUnpaid: false,
    })

    // Balance: 10 credited, 0 used, 0 cf
    mockDb.leaveBalance.findUnique.mockResolvedValue({
      id: 'bal_1',
      employeeId: 'emp_1',
      leaveTypeId: 'lt_annual',
      year: 2026,
      credited: new Prisma.Decimal('10.00'),
      carriedForward: new Prisma.Decimal('0.00'),
      used: new Prisma.Decimal('0.00'),
    })

    // No pending requests
    mockDb.leaveRequest.findMany.mockResolvedValue([])
    mockDb.leaveRequest.findFirst.mockResolvedValue(null) // no overlap
    mockDb.leaveRequest.create.mockResolvedValue({
      id: 'req_1',
      employeeId: 'emp_1',
      leaveTypeId: 'lt_annual',
      startDate: new Date(todayStr),
      endDate: new Date(tomorrowStr),
      days: 2,
      status: LEAVE_STATUS.PENDING,
    })

    const req = new Request('http://localhost:3000/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaveTypeId: 'lt_annual',
        startDate: todayStr,
        endDate: tomorrowStr,
        reason: 'Family vacation',
      }),
    })

    const res = await applyLeave(req)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.data.days).toBe(2)

    // Used was NOT incremented upon application (remains pending only)
    expect(mockDb.leaveBalance.update).toHaveBeenCalledTimes(0)
  })

  it('5.b: Apply over balance -> 400, no LeaveRequest row created', async () => {
    setAuthContext({
      userId: 'user_emp_1',
      role: ROLES.EMPLOYEE,
      employeeId: 'emp_1',
    })

    mockDb.leaveType.findFirst.mockResolvedValue({
      id: 'lt_casual',
      name: 'Casual Leave',
      companyId: 'company_alpha',
      isUnpaid: false,
    })

    // Balance: only 1 day available
    mockDb.leaveBalance.findUnique.mockResolvedValue({
      id: 'bal_2',
      employeeId: 'emp_1',
      leaveTypeId: 'lt_casual',
      year: 2026,
      credited: new Prisma.Decimal('3.00'),
      carriedForward: new Prisma.Decimal('0.00'),
      used: new Prisma.Decimal('2.00'), // 1 available
    })

    mockDb.leaveRequest.findMany.mockResolvedValue([])
    mockDb.leaveRequest.findFirst.mockResolvedValue(null)

    // Requesting 2 days (today to tomorrow = 2 days)
    const req = new Request('http://localhost:3000/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaveTypeId: 'lt_casual',
        startDate: todayStr,
        endDate: tomorrowStr,
        reason: 'Personal errand',
      }),
    })

    const res = await applyLeave(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Insufficient leave balance: available 1(\.00)?, requested 2(\.00)?/)

    // No LeaveRequest created
    expect(mockDb.leaveRequest.create).toHaveBeenCalledTimes(0)
  })

  it('5.c: Concurrent double-apply (simulate two requests) -> only one succeeds', async () => {
    setAuthContext({
      userId: 'user_emp_1',
      role: ROLES.EMPLOYEE,
      employeeId: 'emp_1',
    })

    mockDb.leaveType.findFirst.mockResolvedValue({
      id: 'lt_annual',
      name: 'Annual Leave',
      companyId: 'company_alpha',
      isUnpaid: false,
    })

    // Available: 5.00 days
    const balance = {
      id: 'bal_1',
      employeeId: 'emp_1',
      leaveTypeId: 'lt_annual',
      year: 2026,
      credited: new Prisma.Decimal('5.00'),
      carriedForward: new Prisma.Decimal('0.00'),
      used: new Prisma.Decimal('0.00'),
    }
    mockDb.leaveBalance.findUnique.mockResolvedValue(balance)

    const pendingList: Array<{ days: number }> = []
    mockDb.leaveRequest.findMany.mockImplementation(() => Promise.resolve([...pendingList]))
    mockDb.leaveRequest.findFirst.mockResolvedValue(null) // no overlap
    mockDb.leaveRequest.create.mockImplementation(({ data }) => {
      pendingList.push({ days: data.days })
      return Promise.resolve({ id: 'req_created', ...data })
    })

    // Request 1: 3 days (today to dayAfter = 3 days)
    const req1 = new Request('http://localhost:3000/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaveTypeId: 'lt_annual',
        startDate: todayStr,
        endDate: dayAfterStr,
        reason: 'Trip 1',
      }),
    })

    // Request 2: 3 days
    const nextWeekStart = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0]
    const nextWeekEnd = new Date(today.getTime() + 9 * 86400000).toISOString().split('T')[0]
    const req2 = new Request('http://localhost:3000/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaveTypeId: 'lt_annual',
        startDate: nextWeekStart,
        endDate: nextWeekEnd,
        reason: 'Trip 2',
      }),
    })

    // Execute Request 1 then Request 2 in serialized transaction
    const res1 = await applyLeave(req1)
    expect(res1.status).toBe(201)

    const res2 = await applyLeave(req2)
    expect(res2.status).toBe(400)
    const json2 = await res2.json()
    // Available became 2 after request 1; request 2 asked for 3 -> rejected!
    expect(json2.error).toMatch(/Insufficient leave balance: available 2(\.00)?, requested 3(\.00)?/)
  })

  it('5.d: Approve increments used; reject of pending does not touch used', async () => {
    setAuthContext({
      userId: 'user_mgr_1',
      role: ROLES.MANAGER,
      employeeId: 'mgr_1',
    })

    // 1. Approval Case
    mockDb.leaveRequest.findUnique.mockResolvedValue({
      id: 'req_approve',
      employeeId: 'emp_1',
      leaveTypeId: 'lt_annual',
      startDate: new Date(todayStr),
      endDate: new Date(tomorrowStr),
      days: 2,
      status: LEAVE_STATUS.PENDING,
      employee: {
        userId: 'user_emp_1',
        managerId: 'mgr_1',
        assignments: [{ companyId: 'company_alpha' }],
        user: { name: 'Emp One', email: 'emp1@alpha.com' },
      },
      leaveType: { name: 'Annual Leave', isUnpaid: false },
    })

    const initialBalance = {
      id: 'bal_1',
      employeeId: 'emp_1',
      leaveTypeId: 'lt_annual',
      year: 2026,
      credited: new Prisma.Decimal('10.00'),
      carriedForward: new Prisma.Decimal('0.00'),
      used: new Prisma.Decimal('1.00'),
    }
    mockDb.leaveBalance.findUnique.mockResolvedValue(initialBalance)
    mockDb.leaveRequest.findMany.mockResolvedValue([]) // other pending
    mockDb.attendance.findUnique.mockResolvedValue(null)
    mockDb.employeeCompanyAssignment.findFirst.mockResolvedValue({ companyId: 'company_alpha' })
    mockDb.leaveRequest.update.mockResolvedValue({ id: 'req_approve', status: LEAVE_STATUS.APPROVED })

    const approveReq = new Request('http://localhost:3000/api/leaves/req_approve', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: LEAVE_STATUS.APPROVED }),
    })

    const approveRes = await updateLeave(approveReq, { params: Promise.resolve({ id: 'req_approve' }) })
    expect(approveRes.status).toBe(200)

    // Used incremented from 1 to 3
    expect(mockDb.leaveBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bal_1' },
        data: { used: new Prisma.Decimal('3.00') },
      })
    )

    // 2. Reject Case
    vi.clearAllMocks()
    mockDb.leaveRequest.findUnique.mockResolvedValue({
      id: 'req_reject',
      employeeId: 'emp_1',
      leaveTypeId: 'lt_annual',
      startDate: new Date(todayStr),
      endDate: new Date(tomorrowStr),
      days: 2,
      status: LEAVE_STATUS.PENDING,
      employee: {
        userId: 'user_emp_1',
        managerId: 'mgr_1',
        assignments: [{ companyId: 'company_alpha' }],
        user: { name: 'Emp One', email: 'emp1@alpha.com' },
      },
      leaveType: { name: 'Annual Leave', isUnpaid: false },
    })
    mockDb.leaveRequest.update.mockResolvedValue({ id: 'req_reject', status: LEAVE_STATUS.REJECTED })

    const rejectReq = new Request('http://localhost:3000/api/leaves/req_reject', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: LEAVE_STATUS.REJECTED, comment: 'Staff shortage' }),
    })

    const rejectRes = await updateLeave(rejectReq, { params: Promise.resolve({ id: 'req_reject' }) })
    expect(rejectRes.status).toBe(200)

    // Reject of pending does NOT touch leaveBalance.update
    expect(mockDb.leaveBalance.update).toHaveBeenCalledTimes(0)
  })

  it('5.e: Cancel of an approved request decrements used, floors at 0', async () => {
    setAuthContext({
      userId: 'user_admin_1',
      role: ROLES.COMPANY_ADMIN,
      employeeId: 'admin_1',
    })

    mockDb.userCompanyScope.findMany.mockResolvedValue([{ companyId: 'company_alpha' }])

    // Previously APPROVED request
    mockDb.leaveRequest.findUnique.mockResolvedValue({
      id: 'req_cancel',
      employeeId: 'emp_1',
      leaveTypeId: 'lt_annual',
      startDate: new Date(todayStr),
      endDate: new Date(tomorrowStr),
      days: 2,
      status: LEAVE_STATUS.APPROVED,
      employee: {
        userId: 'user_emp_1',
        managerId: 'mgr_1',
        assignments: [{ companyId: 'company_alpha' }],
        user: { name: 'Emp One', email: 'emp1@alpha.com' },
      },
      leaveType: { name: 'Annual Leave', isUnpaid: false },
    })

    mockDb.leaveBalance.findUnique.mockResolvedValue({
      id: 'bal_1',
      employeeId: 'emp_1',
      leaveTypeId: 'lt_annual',
      year: 2026,
      credited: new Prisma.Decimal('10.00'),
      carriedForward: new Prisma.Decimal('0.00'),
      used: new Prisma.Decimal('1.00'), // 1 used; decremented by 2 -> floors at 0.00
    })

    mockDb.leaveRequest.update.mockResolvedValue({ id: 'req_cancel', status: LEAVE_STATUS.CANCELLED })

    const cancelReq = new Request('http://localhost:3000/api/leaves/req_cancel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: LEAVE_STATUS.CANCELLED }),
    })

    const res = await updateLeave(cancelReq, { params: Promise.resolve({ id: 'req_cancel' }) })
    expect(res.status).toBe(200)

    // Used decremented and floored at 0.00 (not -1.00)
    expect(mockDb.leaveBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bal_1' },
        data: { used: new Prisma.Decimal('0.00') },
      })
    )
  })

  it('5.f: Unpaid/LOP type with zero balance -> allowed', async () => {
    setAuthContext({
      userId: 'user_emp_1',
      role: ROLES.EMPLOYEE,
      employeeId: 'emp_1',
    })

    mockDb.leaveType.findFirst.mockResolvedValue({
      id: 'lt_lop',
      name: 'Loss of Pay',
      companyId: 'company_alpha',
      isUnpaid: true, // LOP bypasses balance check
    })

    mockDb.leaveRequest.findFirst.mockResolvedValue(null) // no overlap
    mockDb.leaveRequest.create.mockResolvedValue({
      id: 'req_lop_1',
      employeeId: 'emp_1',
      leaveTypeId: 'lt_lop',
      startDate: new Date(todayStr),
      endDate: new Date(tomorrowStr),
      days: 2,
      status: LEAVE_STATUS.PENDING,
    })

    const req = new Request('http://localhost:3000/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaveTypeId: 'lt_lop',
        startDate: todayStr,
        endDate: tomorrowStr,
        reason: 'Unforeseen personal matter',
      }),
    })

    const res = await applyLeave(req)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)

    // Balance query was never needed for unpaid type
    expect(mockDb.leaveBalance.findUnique).toHaveBeenCalledTimes(0)
  })

  it('5.g: Cross-tenant: HR of ALPHA cannot read BETA employee balance (403)', async () => {
    setAuthContext({
      userId: 'user_hr_alpha',
      role: ROLES.HR,
      employeeId: 'hr_alpha',
    })

    // HR is scoped strictly to company_alpha
    mockDb.userCompanyScope.findMany.mockResolvedValue([{ companyId: 'company_alpha' }])

    // Employee belongs strictly to company_beta
    mockDb.employee.findUnique.mockResolvedValue({
      id: 'emp_beta_1',
      assignments: [{ companyId: 'company_beta' }],
    })

    const req = new Request('http://localhost:3000/api/leaves/balance?employeeId=emp_beta_1')
    const res = await getLeaveBalance(req)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/out of scope/i)
  })

  it('5.h: Employee cannot read another employee balance (403)', async () => {
    setAuthContext({
      userId: 'user_emp_1',
      role: ROLES.EMPLOYEE,
      employeeId: 'emp_1',
    })

    const req = new Request('http://localhost:3000/api/leaves/balance?employeeId=emp_other')
    const res = await getLeaveBalance(req)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/only view their own/i)
  })
})
