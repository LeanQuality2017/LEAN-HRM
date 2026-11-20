import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveAttendanceCompanyId,
  AttendanceScopeError,
} from '@/lib/attendance/companyScope'
import { ROLES } from '@/lib/constants'
import type { AuthContext } from '@/lib/api-auth'
import { GET as getAttendance } from '@/app/api/attendance/route'

// -------------------------------------------------------------
// Hoisted Mock Setup for Route-Level Scoping Test (C7)
// -------------------------------------------------------------
const { mockDb, getAuthContext, setAuthContext } = vi.hoisted(() => {
  let currentAuth: AuthContext | null = null

  const db = {
    employeeCompanyAssignment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    userCompanyScope: {
      findMany: vi.fn(),
    },
    attendance: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
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

describe('Attendance Company Scoping & Legacy Compatibility (C1..C7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('C1: requestedCompanyId with a valid active assignment -> returns it', async () => {
    const mockClient = {
      employeeCompanyAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { companyId: 'company_alpha', isPrimary: true },
          { companyId: 'company_beta', isPrimary: false },
        ]),
      },
    }

    const resolved = await resolveAttendanceCompanyId('emp_1', 'company_beta', mockClient)
    expect(resolved).toBe('company_beta')
    expect(mockClient.employeeCompanyAssignment.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp_1' },
      orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
      select: { companyId: true, isPrimary: true },
    })
  })

  it('C2: requestedCompanyId with NO active assignment -> falls back to primary', async () => {
    const mockClient = {
      employeeCompanyAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { companyId: 'company_alpha', isPrimary: true },
          { companyId: 'company_beta', isPrimary: false },
        ]),
      },
    }

    // company_gamma is not assigned to emp_1
    const resolved = await resolveAttendanceCompanyId('emp_1', 'company_gamma', mockClient)
    expect(resolved).toBe('company_alpha')
  })

  it('C3: no requestedCompanyId -> returns primary assignment\'s company', async () => {
    const mockClient = {
      employeeCompanyAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { companyId: 'company_beta', isPrimary: false },
          { companyId: 'company_alpha', isPrimary: true },
        ]),
      },
    }

    const resolvedNull = await resolveAttendanceCompanyId('emp_1', null, mockClient)
    expect(resolvedNull).toBe('company_alpha')

    const resolvedUndefined = await resolveAttendanceCompanyId('emp_1', undefined, mockClient)
    expect(resolvedUndefined).toBe('company_alpha')
  })

  it('C4: no primary flag set -> returns the earliest assignment deterministically', async () => {
    const mockClient = {
      employeeCompanyAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { companyId: 'company_first', isPrimary: false },
          { companyId: 'company_second', isPrimary: false },
        ]),
      },
    }

    const resolved = await resolveAttendanceCompanyId('emp_1', null, mockClient)
    expect(resolved).toBe('company_first')
  })

  it('C5: employee with zero assignments -> throws AttendanceScopeError', async () => {
    const mockClient = {
      employeeCompanyAssignment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    }

    await expect(resolveAttendanceCompanyId('emp_orphan', null, mockClient)).rejects.toThrow(
      AttendanceScopeError
    )
    await expect(resolveAttendanceCompanyId('emp_orphan', null, mockClient)).rejects.toThrow(
      /has no company assignments/
    )
  })

  it('C6: shared employee (two companies) -> same date resolves to the SAME company on two consecutive calls (deterministic, no flapping)', async () => {
    const mockClient = {
      employeeCompanyAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { companyId: 'company_alpha', isPrimary: true },
          { companyId: 'company_beta', isPrimary: false },
        ]),
      },
    }

    const call1 = await resolveAttendanceCompanyId('emp_shared', null, mockClient)
    const call2 = await resolveAttendanceCompanyId('emp_shared', null, mockClient)
    expect(call1).toBe('company_alpha')
    expect(call2).toBe('company_alpha')
    expect(call1).toBe(call2)
  })

  it('C7: cross-tenant guard: an employee assigned to ALPHA+BETA, HR of ALPHA passes BETA -> helper returns BETA (it is the employee\'s own assignment) and the ROUTE must still 403', async () => {
    // 1. Helper behavior: resolves company_beta since employee genuinely has assignment to it
    const mockClient = {
      employeeCompanyAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { companyId: 'company_alpha', isPrimary: true },
          { companyId: 'company_beta', isPrimary: false },
        ]),
      },
    }
    const helperResult = await resolveAttendanceCompanyId('emp_shared', 'company_beta', mockClient)
    expect(helperResult).toBe('company_beta')

    // 2. Route-level guard: HR of ALPHA queries attendance for company_beta -> route must 403
    setAuthContext({
      userId: 'user_hr_alpha',
      role: ROLES.HR,
      employeeId: 'hr_alpha',
    })
    // HR is scoped strictly to company_alpha
    mockDb.userCompanyScope.findMany.mockResolvedValue([{ companyId: 'company_alpha' }])

    const req = new Request('http://localhost:3000/api/attendance?companyId=company_beta')
    const res = await getAttendance(req)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/Forbidden: Company out of scope/i)
  })
})

