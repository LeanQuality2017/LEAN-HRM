import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'crypto'
import { ROLES, PAYROLL_STATUS } from '@/lib/constants'
import { hashPassword } from '@/lib/password'
import { loginRateLimitMap } from '@/lib/rate-limit'
import type { AuthContext } from '@/lib/api-auth'

// -------------------------------------------------------------
// Hoisted Mock Setup (Vitest Hoisting Safe)
// -------------------------------------------------------------
const { mockDb, getAuthContext, setAuthContext } = vi.hoisted(() => {
  let currentAuth: AuthContext | null = null
  const db = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    employee: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    document: {
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    payroll: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    payrollLine: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    payrollRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    passwordResetToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit_test_id' }),
      findUnique: vi.fn(),
    },
    userCompanyScope: {
      findMany: vi.fn(),
    },
    employeeCompanyAssignment: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    student: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (cbOrArray: unknown) => {
      if (typeof cbOrArray === 'function') {
        return cbOrArray(db)
      }
      return Promise.all(cbOrArray as Promise<unknown>[])
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
  }
})

// Route Handlers
import { GET as getPayrollPdf } from '@/app/api/payroll/[id]/pdf/route'
import { POST as postDocumentPresign } from '@/app/api/documents/presign/route'
import { GET as getDocuments } from '@/app/api/documents/route'
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route'
import { POST as resetPassword } from '@/app/api/auth/reset-password/route'
import { PATCH as patchPayroll } from '@/app/api/payroll/route'

describe('Security & Multi-Tenant Isolation Negative Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loginRateLimitMap.clear()
    setAuthContext(null)
    process.env.ENABLE_DEMO_MODULES = 'true'
  })

  // =========================================================================
  // 1. Payslip PDF Cross-Tenant Leakage Guard (GET /api/payroll/[id]/pdf)
  // =========================================================================
  describe('1. Payroll PDF Route Tenant Isolation (GET /api/payroll/[id]/pdf)', () => {
    it('returns 404 when payslip ID does not exist', async () => {
      setAuthContext({
        userId: 'u_alpha_emp',
        role: ROLES.EMPLOYEE,
        employeeId: 'emp_alpha',
        name: 'Alpha Worker',
      })
      mockDb.payroll.findUnique.mockResolvedValueOnce(null)
      mockDb.payrollLine.findUnique.mockResolvedValueOnce(null)

      const req = new Request('http://localhost:3001/api/payroll/nonexistent_slip/pdf')
      const res = await getPayrollPdf(req, {
        params: Promise.resolve({ id: 'nonexistent_slip' }),
      })

      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe('Payslip not found')
    })

    it('returns 403 when employee in ALPHA attempts to GET payslip PDF of BETA employee', async () => {
      // Caller is an employee of company ALPHA
      setAuthContext({
        userId: 'u_alpha_emp',
        role: ROLES.EMPLOYEE,
        employeeId: 'emp_alpha',
        name: 'Alpha Worker',
      })

      // Payslip record belongs to an employee of company BETA
      mockDb.payroll.findUnique.mockResolvedValueOnce({
        id: 'slip_beta_101',
        month: 10,
        year: 2026,
        basic: 60000,
        allowances: 15000,
        deductions: 5000,
        netPay: 70000,
        status: 'PROCESSED',
        employeeId: 'emp_beta_999',
        employee: {
          id: 'emp_beta_999',
          userId: 'u_beta_emp',
          employeeCode: 'EMP-B999',
          user: { id: 'u_beta_emp', name: 'Beta Worker', email: 'beta@example.com' },
          assignments: [
            {
              companyId: 'comp_beta',
              isPrimary: true,
              company: { id: 'comp_beta', name: 'Beta Solutions', code: 'BETA' },
            },
          ],
        },
      })

      const req = new Request('http://localhost:3001/api/payroll/slip_beta_101/pdf')
      const res = await getPayrollPdf(req, {
        params: Promise.resolve({ id: 'slip_beta_101' }),
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('Forbidden: not authorized to view this payslip')
    })

    it('ensures response body never leaks employee or payroll data on 403 unauthorized attempt', async () => {
      setAuthContext({
        userId: 'u_alpha_emp',
        role: ROLES.EMPLOYEE,
        employeeId: 'emp_alpha',
        name: 'Alpha Worker',
      })

      mockDb.payroll.findUnique.mockResolvedValueOnce({
        id: 'slip_beta_secret',
        month: 10,
        year: 2026,
        basic: 120000,
        allowances: 30000,
        deductions: 10000,
        netPay: 140000,
        status: 'PROCESSED',
        employee: {
          id: 'emp_beta_exec',
          userId: 'u_beta_exec',
          employeeCode: 'EXEC-001',
          user: { id: 'u_beta_exec', name: 'Beta Executive', email: 'exec@beta.com' },
          assignments: [{ companyId: 'comp_beta' }],
        },
      })

      const req = new Request('http://localhost:3001/api/payroll/slip_beta_secret/pdf')
      const res = await getPayrollPdf(req, {
        params: Promise.resolve({ id: 'slip_beta_secret' }),
      })

      expect(res.status).toBe(403)
      const data = await res.json()

      // Absolute negative leak assertion: response must contain only error message
      expect(data.error).toBeDefined()
      expect(data.data).toBeUndefined()
      expect(data.employee).toBeUndefined()
      expect(data.basic).toBeUndefined()
      expect(data.allowances).toBeUndefined()
      expect(data.deductions).toBeUndefined()
      expect(data.netPay).toBeUndefined()
    })

    it('allows an employee to view their own payslip PDF', async () => {
      setAuthContext({
        userId: 'u_alpha_emp',
        role: ROLES.EMPLOYEE,
        employeeId: 'emp_alpha',
        name: 'Alpha Worker',
      })

      mockDb.payroll.findUnique.mockResolvedValueOnce({
        id: 'slip_alpha_1',
        month: 10,
        year: 2026,
        basic: 40000,
        allowances: 8000,
        deductions: 4000,
        netPay: 44000,
        status: 'PAID',
        employeeId: 'emp_alpha',
        employee: {
          id: 'emp_alpha',
          userId: 'u_alpha_emp',
          employeeCode: 'ALPHA-001',
          user: { id: 'u_alpha_emp', name: 'Alpha Worker', email: 'alpha@example.com' },
          assignments: [
            {
              companyId: 'comp_alpha',
              isPrimary: true,
              company: { id: 'comp_alpha', name: 'Alpha Tech', code: 'ALPHA' },
            },
          ],
        },
      })

      const req = new Request('http://localhost:3001/api/payroll/slip_alpha_1/pdf')
      const res = await getPayrollPdf(req, {
        params: Promise.resolve({ id: 'slip_alpha_1' }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/pdf')
      expect(res.headers.get('Content-Disposition')).toContain('payslip-ALPHA-001-10-2026.pdf')
    })
  })

  // =========================================================================
  // 2. Document Presign Cross-Company Isolation (POST /api/documents/presign)
  // =========================================================================
  describe('2. Document Presign Cross-Tenant Isolation (POST /api/documents/presign)', () => {
    it('returns 403 when COMPANY_ADMIN of ALPHA attempts presign for employee in BETA', async () => {
      setAuthContext({
        userId: 'u_admin_alpha',
        role: ROLES.COMPANY_ADMIN,
        employeeId: null,
        name: 'Admin Alpha',
      })

      // Admin Alpha's company scope is strictly company ALPHA
      mockDb.userCompanyScope.findMany.mockResolvedValueOnce([{ companyId: 'comp_alpha' }])

      // Employee belongs exclusively to company BETA
      mockDb.employee.findUnique.mockResolvedValueOnce({
        id: 'emp_beta_target',
        assignments: [{ companyId: 'comp_beta' }],
      })

      const req = new Request('http://localhost:3001/api/documents/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'EMPLOYEE',
          ownerId: 'emp_beta_target',
          type: 'ID_PROOF',
          mime: 'application/pdf',
          size: 10240,
          fileName: 'passport.pdf',
        }),
      })

      const res = await postDocumentPresign(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('Forbidden: employee does not belong to any administered company')
    })

    it('returns 403 when EMPLOYEE attempts presign for another employee', async () => {
      setAuthContext({
        userId: 'u_emp_1',
        role: ROLES.EMPLOYEE,
        employeeId: 'emp_001',
        name: 'Worker 1',
      })

      mockDb.employee.findUnique.mockResolvedValueOnce({
        id: 'emp_002',
        assignments: [{ companyId: 'comp_alpha' }],
      })

      const req = new Request('http://localhost:3001/api/documents/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'EMPLOYEE',
          ownerId: 'emp_002',
          type: 'RESUME',
          mime: 'application/pdf',
          size: 5120,
          fileName: 'cv.pdf',
        }),
      })

      const res = await postDocumentPresign(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('Forbidden: employees may only upload documents for their own profile')
    })

    it('permits COMPANY_ADMIN of ALPHA to presign upload for employee in ALPHA', async () => {
      setAuthContext({
        userId: 'u_admin_alpha',
        role: ROLES.COMPANY_ADMIN,
        employeeId: null,
        name: 'Admin Alpha',
      })

      mockDb.userCompanyScope.findMany.mockResolvedValueOnce([{ companyId: 'comp_alpha' }])
      mockDb.employee.findUnique.mockResolvedValueOnce({
        id: 'emp_alpha_target',
        assignments: [{ companyId: 'comp_alpha' }],
      })
      mockDb.document.create.mockResolvedValueOnce({
        id: 'doc_alpha_1',
        ownerType: 'EMPLOYEE',
        ownerId: 'emp_alpha_target',
      })

      const req = new Request('http://localhost:3001/api/documents/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'EMPLOYEE',
          ownerId: 'emp_alpha_target',
          type: 'CONTRACT',
          mime: 'application/pdf',
          size: 20480,
          fileName: 'offer_letter.pdf',
        }),
      })

      const res = await postDocumentPresign(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.data.uploadUrl).toBeDefined()
      expect(json.data.fileKey).toContain('employees/emp_alpha_target/contract/')
    })
  })

  // =========================================================================
  // 3. Document Listing Ownership Isolation (GET /api/documents)
  // =========================================================================
  describe('3. Document List Ownership Scope (GET /api/documents)', () => {
    it('returns 403 when EMPLOYEE requests documents with another employee ownerId', async () => {
      setAuthContext({
        userId: 'u_emp_alpha',
        role: ROLES.EMPLOYEE,
        employeeId: 'emp_alpha',
        name: 'Alpha Worker',
      })

      const req = new Request('http://localhost:3001/api/documents?ownerType=EMPLOYEE&ownerId=emp_beta')
      const res = await getDocuments(req)

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('Forbidden: cannot view documents of another employee')
    })

    it('returns 403 when EMPLOYEE requests documents with COMPANY ownerType', async () => {
      setAuthContext({
        userId: 'u_emp_alpha',
        role: ROLES.EMPLOYEE,
        employeeId: 'emp_alpha',
        name: 'Alpha Worker',
      })
      mockDb.userCompanyScope.findMany.mockResolvedValueOnce([])

      const req = new Request('http://localhost:3001/api/documents?ownerType=COMPANY&ownerId=comp_alpha')
      const res = await getDocuments(req)

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('Forbidden: company out of scope')
    })

    it('strictly scopes general document listing to EMPLOYEE own ownerId and ownerType', async () => {
      setAuthContext({
        userId: 'u_emp_alpha',
        role: ROLES.EMPLOYEE,
        employeeId: 'emp_alpha',
        name: 'Alpha Worker',
      })

      mockDb.document.count.mockResolvedValueOnce(1)
      mockDb.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc_1',
          ownerType: 'EMPLOYEE',
          ownerId: 'emp_alpha',
          fileName: 'my_id.pdf',
          uploader: { id: 'u_emp_alpha', name: 'Alpha Worker', email: 'alpha@work.com' },
        },
      ])

      const req = new Request('http://localhost:3001/api/documents')
      const res = await getDocuments(req)

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)

      // Verify that Prisma findMany was called with where filter strictly constrained to the caller's employeeId
      expect(mockDb.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ownerType: 'EMPLOYEE',
            ownerId: 'emp_alpha',
          }),
        })
      )
    })
  })

  // =========================================================================
  // 4. Forgot Password Enumeration Resistance & Rate Limiting
  // =========================================================================
  describe('4. Forgot Password Security & Rate Limiting (POST /api/auth/forgot-password)', () => {
    it('returns identical status and message for existing and non-existing email (enumeration resistance)', async () => {
      // 1. Existing user
      mockDb.user.findUnique.mockResolvedValueOnce({
        id: 'u_exist',
        name: 'Existing User',
        email: 'exist@example.com',
        isActive: true,
      })
      mockDb.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 })
      mockDb.passwordResetToken.create.mockResolvedValueOnce({ id: 'tok_1' })

      const reqExist = new Request('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
        body: JSON.stringify({ email: 'exist@example.com' }),
      })
      const resExist = await forgotPassword(reqExist)
      const dataExist = await resExist.json()

      // 2. Non-existing user
      mockDb.user.findUnique.mockResolvedValueOnce(null)

      const reqNonExist = new Request('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.2' },
        body: JSON.stringify({ email: 'nonexist@example.com' }),
      })
      const resNonExist = await forgotPassword(reqNonExist)
      const dataNonExist = await resNonExist.json()

      // Both must yield identical HTTP status 200 and identical message
      expect(resExist.status).toBe(200)
      expect(resNonExist.status).toBe(200)
      expect(dataExist).toEqual(dataNonExist)
      expect(dataExist.ok).toBe(true)
      expect(dataExist.message).toBe(
        'If an account with that email exists, password reset instructions have been sent.'
      )
    })

    it('enforces rate limiting after N failed/unknown attempts (returns 429)', async () => {
      const email = 'target@victim.com'
      const clientIp = '192.168.1.50'

      // Simulate 5 attempts for non-existing user (each records a failed attempt in rate limiter)
      for (let i = 0; i < 5; i++) {
        mockDb.user.findUnique.mockResolvedValueOnce(null)
        const req = new Request('http://localhost:3001/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp },
          body: JSON.stringify({ email }),
        })
        const res = await forgotPassword(req)
        expect(res.status).toBe(200) // First 5 return generic success
      }

      // 6th attempt: Rate limit is exceeded
      const lockedReq = new Request('http://localhost:3001/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp },
        body: JSON.stringify({ email }),
      })
      const lockedRes = await forgotPassword(lockedReq)

      expect(lockedRes.status).toBe(429)
      const lockedData = await lockedRes.json()
      expect(lockedData.error).toBe('Too many requests, try again later')
    })
  })

  // =========================================================================
  // 5. Reset Password Token Invalidation & Inactive User Guards
  // =========================================================================
  describe('5. Reset Password Token Validation (POST /api/auth/reset-password)', () => {
    const rawToken = 'sample_raw_reset_token_64_chars_long_abcdef1234567890'
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')

    it('rejects an expired token with 400', async () => {
      mockDb.passwordResetToken.findUnique.mockResolvedValueOnce({
        id: 'tok_expired',
        tokenHash,
        userId: 'u_user_1',
        expiresAt: new Date(Date.now() - 1000 * 60 * 10), // expired 10 minutes ago
        usedAt: null,
        user: { id: 'u_user_1', email: 'alice@test.com', isActive: true },
      })

      const req = new Request('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: rawToken,
          newPassword: 'BrandNewSecurePass123!',
        }),
      })

      const res = await resetPassword(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Invalid or expired password reset link. Please request a new one.')
    })

    it('rejects a reused token with 400', async () => {
      mockDb.passwordResetToken.findUnique.mockResolvedValueOnce({
        id: 'tok_reused',
        tokenHash,
        userId: 'u_user_1',
        expiresAt: new Date(Date.now() + 1000 * 60 * 20),
        usedAt: new Date(Date.now() - 1000 * 60 * 5), // already marked used
        user: { id: 'u_user_1', email: 'alice@test.com', isActive: true },
      })

      const req = new Request('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: rawToken,
          newPassword: 'BrandNewSecurePass123!',
        }),
      })

      const res = await resetPassword(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Invalid or expired password reset link. Please request a new one.')
    })

    it('rejects a token belonging to an inactive user with 400', async () => {
      mockDb.passwordResetToken.findUnique.mockResolvedValueOnce({
        id: 'tok_inactive_user',
        tokenHash,
        userId: 'u_inactive',
        expiresAt: new Date(Date.now() + 1000 * 60 * 20),
        usedAt: null,
        user: { id: 'u_inactive', email: 'inactive@test.com', isActive: false },
      })

      const req = new Request('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: rawToken,
          newPassword: 'BrandNewSecurePass123!',
        }),
      })

      const res = await resetPassword(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Account is inactive or not found.')
    })

    it('rejects a non-existent/tampered token with 400', async () => {
      mockDb.passwordResetToken.findUnique.mockResolvedValueOnce(null)

      const req = new Request('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'tampered_invalid_token',
          newPassword: 'BrandNewSecurePass123!',
        }),
      })

      const res = await resetPassword(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Invalid or expired password reset link. Please request a new one.')
    })

    it('successfully resets password and marks token used on valid submission', async () => {
      mockDb.passwordResetToken.findUnique.mockResolvedValueOnce({
        id: 'tok_valid',
        tokenHash,
        userId: 'u_alice',
        expiresAt: new Date(Date.now() + 1000 * 60 * 25),
        usedAt: null,
        user: { id: 'u_alice', email: 'alice@test.com', isActive: true },
      })
      mockDb.user.update.mockResolvedValueOnce({ id: 'u_alice' })
      mockDb.passwordResetToken.update.mockResolvedValueOnce({ id: 'tok_valid' })
      mockDb.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 1 })

      const req = new Request('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: rawToken,
          newPassword: 'ValidNewPassword123!',
        }),
      })

      const res = await resetPassword(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.message).toContain('Password has been successfully reset')
    })
  })

  // =========================================================================
  // 6. Payroll PATCH SUPER_ADMIN Role & Step-Up Security
  // =========================================================================
  describe('6. Payroll PATCH SUPER_ADMIN Role & Step-Up Security (PATCH /api/payroll)', () => {
    it('returns 403 when non-SUPER_ADMIN (COMPANY_ADMIN) attempts PATCH /api/payroll', async () => {
      setAuthContext({
        userId: 'u_admin_alpha',
        role: ROLES.COMPANY_ADMIN,
        employeeId: null,
        name: 'Company Admin Alpha',
      })

      const req = new Request('http://localhost:3001/api/payroll?id=run_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: PAYROLL_STATUS.LOCKED }),
      })

      const res = await patchPayroll(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('Forbidden: insufficient permissions')
    })

    it('5.d: returns 403 when SUPER_ADMIN attempts status change without step-up credentials in body', async () => {
      setAuthContext({
        userId: 'sa_user_id',
        role: ROLES.SUPER_ADMIN,
        employeeId: null,
        name: 'Super Admin',
      })

      const req = new Request('http://localhost:3001/api/payroll?id=run_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: PAYROLL_STATUS.LOCKED }),
      })

      const res = await patchPayroll(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('step-up authentication required')
    })

    it('5.e: returns 403 when SUPER_ADMIN supplies step-up credentials only in headers (headers no longer accepted)', async () => {
      setAuthContext({
        userId: 'sa_user_id',
        role: ROLES.SUPER_ADMIN,
        employeeId: null,
        name: 'Super Admin',
      })

      const req = new Request('http://localhost:3001/api/payroll?id=run_001', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-step-up-email': 'superadmin@unihr.com',
          'x-step-up-password': 'CorrectSuperAdminPassword123!',
        },
        body: JSON.stringify({ status: PAYROLL_STATUS.LOCKED }),
      })

      const res = await patchPayroll(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('step-up authentication required')
    })

    it('returns 403 when non-SUPER_ADMIN (HR) attempts PATCH /api/payroll', async () => {
      setAuthContext({
        userId: 'u_hr_staff',
        role: ROLES.HR,
        employeeId: null,
        name: 'HR Officer',
      })

      const req = new Request('http://localhost:3001/api/payroll?id=run_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: PAYROLL_STATUS.LOCKED }),
      })

      const res = await patchPayroll(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('Forbidden: insufficient permissions')
    })

    it('returns 401 when SUPER_ADMIN supplies invalid step-up password', async () => {
      setAuthContext({
        userId: 'sa_user_id',
        role: ROLES.SUPER_ADMIN,
        employeeId: null,
        name: 'Super Admin',
      })

      const validHash = hashPassword('CorrectSuperAdminPassword123!')
      mockDb.user.findUnique.mockResolvedValueOnce({
        id: 'sa_user_id',
        email: 'superadmin@unihr.com',
        role: ROLES.SUPER_ADMIN,
        passwordHash: validHash,
        isActive: true,
      })

      const req = new Request('http://localhost:3001/api/payroll?id=run_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
        body: JSON.stringify({
          status: PAYROLL_STATUS.LOCKED,
          email: 'superadmin@unihr.com',
          password: 'WrongPasswordSubmitted!',
        }),
      })

      const res = await patchPayroll(req)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('Invalid credentials')
    })

    it('returns 401 when SUPER_ADMIN step-up attempts to verify against another user email', async () => {
      setAuthContext({
        userId: 'sa_user_id',
        role: ROLES.SUPER_ADMIN,
        employeeId: null,
        name: 'Super Admin',
      })

      const validHash = hashPassword('SomePassword123!')
      mockDb.user.findUnique.mockResolvedValueOnce({
        id: 'different_user_id', // does not match caller sa_user_id
        email: 'other_admin@unihr.com',
        role: ROLES.SUPER_ADMIN,
        passwordHash: validHash,
        isActive: true,
      })

      const req = new Request('http://localhost:3001/api/payroll?id=run_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
        body: JSON.stringify({
          status: PAYROLL_STATUS.LOCKED,
          email: 'other_admin@unihr.com',
          password: 'SomePassword123!',
        }),
      })

      const res = await patchPayroll(req)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('Invalid credentials')
    })

    it('returns 429 when SUPER_ADMIN step-up attempts exceed rate limit', async () => {
      setAuthContext({
        userId: 'sa_user_id',
        role: ROLES.SUPER_ADMIN,
        employeeId: null,
        name: 'Super Admin',
      })

      const validHash = hashPassword('CorrectPassword123!')
      const clientIp = '10.0.0.88'

      // Simulate 5 consecutive failed step-up attempts
      for (let i = 0; i < 5; i++) {
        mockDb.user.findUnique.mockResolvedValueOnce({
          id: 'sa_user_id',
          email: 'superadmin@unihr.com',
          role: ROLES.SUPER_ADMIN,
          passwordHash: validHash,
          isActive: true,
        })

        const req = new Request('http://localhost:3001/api/payroll?id=run_001', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp },
          body: JSON.stringify({
            status: PAYROLL_STATUS.LOCKED,
            email: 'superadmin@unihr.com',
            password: 'BadPassword!',
          }),
        })
        const res = await patchPayroll(req)
        expect(res.status).toBe(401)
      }

      // 6th attempt: rate limited
      const lockedReq = new Request('http://localhost:3001/api/payroll?id=run_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp },
        body: JSON.stringify({
          status: PAYROLL_STATUS.LOCKED,
          email: 'superadmin@unihr.com',
          password: 'BadPassword!',
        }),
      })

      const lockedRes = await patchPayroll(lockedReq)
      expect(lockedRes.status).toBe(429)
      const lockedData = await lockedRes.json()
      expect(lockedData.error).toBe('Too many attempts, try again later')
    })

    it('permits SUPER_ADMIN to advance status when valid step-up credentials are supplied', async () => {
      setAuthContext({
        userId: 'sa_user_id',
        role: ROLES.SUPER_ADMIN,
        employeeId: null,
        name: 'Super Admin',
      })

      const validPassword = 'RealSuperAdminPassword123!'
      const validHash = hashPassword(validPassword)

      mockDb.user.findUnique.mockResolvedValueOnce({
        id: 'sa_user_id',
        email: 'superadmin@unihr.com',
        role: ROLES.SUPER_ADMIN,
        passwordHash: validHash,
        isActive: true,
      })

      mockDb.payrollRun.findUnique.mockResolvedValueOnce({
        id: 'run_001',
        companyId: 'comp_alpha',
        month: 11,
        year: 2026,
        status: PAYROLL_STATUS.DRAFT,
        lines: [],
        totalGross: 50000,
        totalNet: 45000,
        totalDeductions: 5000,
        totalStatutory: 3000,
      })

      mockDb.payrollRun.update.mockResolvedValueOnce({
        id: 'run_001',
        companyId: 'comp_alpha',
        month: 11,
        year: 2026,
        status: PAYROLL_STATUS.LOCKED,
        totalGross: 50000,
        totalNet: 45000,
        totalDeductions: 5000,
        totalStatutory: 3000,
      })

      mockDb.payroll.updateMany.mockResolvedValueOnce({ count: 1 })
      mockDb.userCompanyScope.findMany.mockResolvedValueOnce([])

      const req = new Request('http://localhost:3001/api/payroll?runId=run_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
        body: JSON.stringify({
          status: PAYROLL_STATUS.LOCKED,
          email: 'superadmin@unihr.com',
          password: validPassword,
        }),
      })

      const res = await patchPayroll(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.data.status).toBe(PAYROLL_STATUS.LOCKED)
    })
  })
})
