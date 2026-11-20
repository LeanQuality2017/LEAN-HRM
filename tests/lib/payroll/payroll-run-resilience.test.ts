import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { ROLES, PAYROLL_STATUS } from '@/lib/constants'
import type { AuthContext } from '@/lib/api-auth'

// -------------------------------------------------------------
// Hoisted Mock Setup
// -------------------------------------------------------------
const { mockDb, getAuthContext, setAuthContext } = vi.hoisted(() => {
  let currentAuth: AuthContext | null = null
  const db = {
    company: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    userCompanyScope: {
      findMany: vi.fn(),
    },
    payrollRun: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    companyPayRule: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
    },
    attendance: {
      findMany: vi.fn(),
    },
    leaveRequest: {
      findMany: vi.fn(),
    },
    attendanceSummary: {
      upsert: vi.fn(),
    },
    payrollLine: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    payroll: {
      upsert: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit_test_id' }),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => {
      return cb(db)
    }),
  }

  return {
    mockDb: db,
    getAuthContext: () => currentAuth,
    setAuthContext: (val: AuthContext | null) => {
      currentAuth = val
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
    requireAuth: vi.fn(async (roles?: string[]) => {
      const auth = getAuthContext()
      if (!auth) {
        throw new actual.ApiError(401, 'Unauthorized')
      }
      if (roles && roles.length > 0 && !roles.includes(auth.role)) {
        throw new actual.ApiError(403, 'Forbidden: insufficient permissions')
      }
      return auth
    }),
    getScopedCompanyIds: vi.fn(async () => ['comp_alpha']),
    assertCompanyInScope: vi.fn(),
  }
})

import { POST as postPayroll } from '@/app/api/payroll/route'

describe('Payroll Run Resilience & Per-Employee Failure Isolation (POST /api/payroll)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ENABLE_DEMO_MODULES = 'true'
    setAuthContext({
      userId: 'hr_user_id',
      role: ROLES.HR,
      employeeId: null,
      name: 'HR Officer',
    })

    // No existing run
    mockDb.payrollRun.findUnique.mockResolvedValue(null)

    // Pay rule
    mockDb.companyPayRule.findUnique.mockResolvedValue({
      id: 'rule_001',
      companyId: 'comp_alpha',
      workingDaysBasis: 'CALENDAR',
      otMultiplier: new Prisma.Decimal('1.50'),
      payrollCutoffDay: 25,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
    })

    // Default transaction mocks
    mockDb.payrollRun.create.mockResolvedValue({
      id: 'run_new_001',
      companyId: 'comp_alpha',
      month: 11,
      year: 2026,
      status: PAYROLL_STATUS.DRAFT,
      runById: 'hr_user_id',
    })

    mockDb.payrollRun.update.mockImplementation(async ({ data }: any) => ({
      id: 'run_new_001',
      companyId: 'comp_alpha',
      month: 11,
      year: 2026,
      status: PAYROLL_STATUS.DRAFT,
      ...data,
    }))

    mockDb.attendance.findMany.mockResolvedValue([])
    mockDb.leaveRequest.findMany.mockResolvedValue([])
    mockDb.attendanceSummary.upsert.mockResolvedValue({})
    mockDb.payrollLine.findMany.mockResolvedValue([])
    mockDb.payrollLine.create.mockResolvedValue({ id: 'line_created_1' })
    mockDb.payroll.upsert.mockResolvedValue({})
    mockDb.notification.create.mockResolvedValue({})
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit_log_1' })
  })

  // 5.a: Run with 2 employees where one lacks tdsRegime -> response { created: 1, skipped: [1] }, no throw
  it('5.a: creates lines for valid employees and skips employees with missing tdsRegime without aborting run', async () => {
    // Two employees:
    // Emp 1: valid statutoryProfile with tdsRegime 'NEW'
    // Emp 2: invalid statutoryProfile with missing/empty tdsRegime
    const empValid = {
      id: 'emp_valid_001',
      employeeCode: 'EMP-001',
      userId: 'user_001',
      user: { id: 'user_001', name: 'Valid Worker', email: 'valid@example.com' },
      baseSalary: new Prisma.Decimal('60000.00'),
      salaryStructures: [
        {
          effectiveFrom: new Date('2026-01-01'),
          components: [
            { name: 'BASIC', type: 'EARNING', amount: new Prisma.Decimal('30000.00') },
            { name: 'HRA', type: 'EARNING', amount: new Prisma.Decimal('20000.00') },
            { name: 'SPECIAL_ALLOWANCE', type: 'EARNING', amount: new Prisma.Decimal('10000.00') },
          ],
        },
      ],
      salaryRevisions: [],
      statutoryProfile: {
        pfApplicable: false,
        esiApplicable: false,
        ptState: 'TN',
        tdsRegime: 'NEW',
      },
    }

    const empMissingTds = {
      id: 'emp_missing_002',
      employeeCode: 'EMP-002',
      userId: 'user_002',
      user: { id: 'user_002', name: 'Incomplete Worker', email: 'missing@example.com' },
      baseSalary: new Prisma.Decimal('45000.00'),
      salaryStructures: [],
      salaryRevisions: [],
      statutoryProfile: {
        pfApplicable: false,
        esiApplicable: false,
        ptState: 'TN',
        tdsRegime: '', // Missing TDS regime!
      },
    }

    mockDb.employee.findMany.mockResolvedValueOnce([empValid, empMissingTds])

    const req = new Request('http://localhost:3001/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'comp_alpha',
        month: 11,
        year: 2026,
      }),
    })

    const res = await postPayroll(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.data.created).toBe(1)
    expect(Array.isArray(json.data.skipped)).toBe(true)
    expect(json.data.skipped).toHaveLength(1)

    const skippedRecord = json.data.skipped[0]
    expect(skippedRecord.employeeId).toBe('emp_missing_002')
    expect(skippedRecord.employeeCode).toBe('EMP-002')
    expect(skippedRecord.employeeName).toBe('Incomplete Worker')
    expect(skippedRecord.reason).toContain('TDS regime not configured')
  })

  // 5.b: Audit log entry written containing the skipped employee code
  it('5.b: writes ONE audit log entry containing the skipped employee code and reason in meta', async () => {
    const empValid = {
      id: 'emp_valid_001',
      employeeCode: 'EMP-001',
      userId: 'user_001',
      user: { id: 'user_001', name: 'Valid Worker', email: 'valid@example.com' },
      baseSalary: new Prisma.Decimal('50000.00'),
      salaryStructures: [],
      salaryRevisions: [],
      statutoryProfile: { pfApplicable: false, esiApplicable: false, ptState: 'TN', tdsRegime: 'NEW' },
    }

    const empSkipped = {
      id: 'emp_skipped_003',
      employeeCode: 'EMP-003',
      userId: 'user_003',
      user: { id: 'user_003', name: 'Skipped Worker', email: 'skipped@example.com' },
      baseSalary: new Prisma.Decimal('50000.00'),
      salaryStructures: [],
      salaryRevisions: [],
      statutoryProfile: null, // completely missing statutory profile!
    }

    mockDb.employee.findMany.mockResolvedValueOnce([empValid, empSkipped])

    const req = new Request('http://localhost:3001/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'comp_alpha',
        month: 11,
        year: 2026,
      }),
    })

    const res = await postPayroll(req)
    expect(res.status).toBe(200)

    // Verify audit log call
    expect(mockDb.auditLog.create).toHaveBeenCalled()
    const auditCall = mockDb.auditLog.create.mock.calls.find((call: any) => {
      return call[0]?.data?.action === 'PAYROLL_GENERATE'
    })

    expect(auditCall).toBeDefined()
    if (!auditCall) throw new Error('auditCall is undefined')
    const metaParsed = JSON.parse(auditCall[0].data.meta)
    expect(metaParsed.linesCount).toBe(1)
    expect(Array.isArray(metaParsed.skipped)).toBe(true)
    expect(metaParsed.skipped).toHaveLength(1)
    expect(metaParsed.skipped[0].employeeCode).toBe('EMP-003')
  })

  // 5.c: Non-PayrollCalculationError (simulated DB failure) -> transaction still aborts (no silent swallow)
  it('5.c: aborts transaction and does not swallow unexpected non-PayrollCalculationError (e.g. DB error)', async () => {
    const emp = {
      id: 'emp_valid_001',
      employeeCode: 'EMP-001',
      userId: 'user_001',
      user: { id: 'user_001', name: 'Valid Worker', email: 'valid@example.com' },
      baseSalary: new Prisma.Decimal('50000.00'),
      salaryStructures: [],
      salaryRevisions: [],
      statutoryProfile: { pfApplicable: false, esiApplicable: false, ptState: 'TN', tdsRegime: 'NEW' },
    }

    mockDb.employee.findMany.mockResolvedValueOnce([emp])

    // Simulate unexpected DB failure when creating payroll line
    mockDb.payrollLine.create.mockRejectedValueOnce(new Error('FATAL: Database disk full'))

    const req = new Request('http://localhost:3001/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'comp_alpha',
        month: 11,
        year: 2026,
      }),
    })

    const res = await postPayroll(req)
    // In UniHR, handle() catches unhandled exceptions and returns HTTP 500
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Internal server error')
  })
})
