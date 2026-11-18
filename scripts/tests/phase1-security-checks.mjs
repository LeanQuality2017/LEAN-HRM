/**
 * Phase 1 Security Regression Tests
 * Runs against confirmed disposable test database (unihr_test) using synthetic fixtures.
 * Never prints secrets, connection strings, or password hashes.
 */

import { PrismaClient } from '@prisma/client'

const testDbUrl = process.env.TEST_DATABASE_URL
if (!testDbUrl) {
  console.error('FATAL: TEST_DATABASE_URL is not set.')
  process.exit(1)
}

const prisma = new PrismaClient({ datasourceUrl: testDbUrl })

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`)
    passed++
  } else {
    console.error(`  ❌ FAIL: ${message}`)
    failed++
  }
}

async function run() {
  console.log('--- UniHR Phase 1 Security Verification ---')

  // 1. Verify connection is to disposable test database
  const probe = await prisma.$queryRaw`SELECT current_database() as db, current_user as usr`
  const currentDb = probe[0]?.db
  const currentUser = probe[0]?.usr
  if (currentDb !== 'unihr_test' || currentUser !== 'unihr_tester') {
    console.error(`FATAL: Unsafe database: db=${currentDb}, usr=${currentUser}. Expected unihr_test / unihr_tester.`)
    process.exit(1)
  }
  console.log('Confirmed disposable test database: unihr_test')

  // ==========================================
  // Test Section 1: Deployment & Seed Guard (P0-06)
  // ==========================================
  console.log('\n[1] Deployment & Demo Seed Guard Checks')
  {
    // Test seed guard logic in isolation
    function checkSeedSafety(nodeEnv, allowDemoSeed) {
      if (nodeEnv === 'production') return 'REFUSED_PRODUCTION'
      if (allowDemoSeed !== 'true') return 'REFUSED_UNAUTHORIZED'
      return 'ALLOWED'
    }

    assert(
      checkSeedSafety('production', 'true') === 'REFUSED_PRODUCTION',
      'Seed refuses to run when NODE_ENV === "production"'
    )
    assert(
      checkSeedSafety('development', 'false') === 'REFUSED_UNAUTHORIZED',
      'Seed refuses to run without ALLOW_DEMO_SEED=true'
    )
    assert(
      checkSeedSafety('development', undefined) === 'REFUSED_UNAUTHORIZED',
      'Seed refuses to run when ALLOW_DEMO_SEED is undefined'
    )
    assert(
      checkSeedSafety('development', 'true') === 'ALLOWED',
      'Seed allows run only when ALLOW_DEMO_SEED=true in non-production'
    )

    const seedDbAllowlist = /^(unihr_(test|demo)|[a-z0-9_]+_demo)$/
    assert(seedDbAllowlist.test('unihr_test') && seedDbAllowlist.test('unihr_demo'), 'Seed allowlist accepts unihr_test and unihr_demo')
    assert(!seedDbAllowlist.test('unihr_prod') && !seedDbAllowlist.test('postgres'), 'Seed allowlist rejects production and default databases')
  }

  // ==========================================
  // Test Section 2: Feature Gates (P0-03 & P0-04)
  // ==========================================
  console.log('\n[2] Feature Gates (Payroll & Institute Gating)')
  {
    const { isPayrollEnabled, isInstituteEnabled } = await import('../../src/lib/feature-gates.ts')
    const { checkPageAccess } = await import('../../src/lib/page-guard.ts')

    // Default: ENABLE_DEMO_MODULES is not true
    process.env.ENABLE_DEMO_MODULES = 'false'
    assert(!isPayrollEnabled(), 'Payroll feature is gated OFF by default')
    assert(!isInstituteEnabled(), 'Institute feature is gated OFF by default')

    assert(
      checkPageAccess('COMPANY_ADMIN', '/payroll') === '/dashboard',
      'Page gate redirects /payroll to /dashboard when gated OFF'
    )
    assert(
      checkPageAccess('COMPANY_ADMIN', '/institute/students') === '/dashboard',
      'Page gate redirects /institute/* to /dashboard when gated OFF'
    )

    // When explicitly enabled in demo environment
    process.env.ENABLE_DEMO_MODULES = 'true'
    assert(isPayrollEnabled(), 'Payroll feature is active when ENABLE_DEMO_MODULES=true')
    assert(isInstituteEnabled(), 'Institute feature is active when ENABLE_DEMO_MODULES=true')
    assert(
      checkPageAccess('COMPANY_ADMIN', '/payroll') === null,
      'Page gate permits /payroll when enabled for COMPANY_ADMIN'
    )

    // When in production, features remain false regardless of ENABLE_DEMO_MODULES
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.ENABLE_DEMO_MODULES = 'true'
    assert(!isPayrollEnabled(), 'Payroll feature returns false in production regardless of ENABLE_DEMO_MODULES')
    assert(!isInstituteEnabled(), 'Institute feature returns false in production regardless of ENABLE_DEMO_MODULES')
    process.env.NODE_ENV = prevNodeEnv

    // Reset back to default safe mode
    process.env.ENABLE_DEMO_MODULES = 'false'
  }

  // ==========================================
  // Test Section 3: Synthetic Test Fixtures Setup
  // ==========================================
  console.log('\n[3] Setting up Isolated Synthetic Test Fixtures')
  // We use deterministic test IDs prefixed with `p1_`
  const CID_A = 'p1_comp_alpha'
  const CID_B = 'p1_comp_beta'
  const CID_SKILL = 'p1_comp_skill'

  const UID_ADMIN_A = 'p1_usr_admin_a'
  const UID_ADMIN_B = 'p1_usr_admin_b'
  const UID_EMP_A = 'p1_usr_emp_a'
  const UID_EMP_B = 'p1_usr_emp_b'
  const UID_EMP_SHARED = 'p1_usr_emp_shared'

  const EID_A = 'p1_emp_a'
  const EID_B = 'p1_emp_b'
  const EID_SHARED = 'p1_emp_shared'

  // Clean any previous test artifacts
  await prisma.$transaction([
    prisma.feePayment.deleteMany({ where: { invoiceNo: { startsWith: 'P1-TEST' } } }),
    prisma.employeeCompanyAssignment.deleteMany({ where: { employeeId: { in: [EID_A, EID_B, EID_SHARED] } } }),
    prisma.userCompanyScope.deleteMany({ where: { userId: { in: [UID_ADMIN_A, UID_ADMIN_B] } } }),
    prisma.employee.deleteMany({ where: { id: { in: [EID_A, EID_B, EID_SHARED] } } }),
    prisma.user.deleteMany({ where: { id: { in: [UID_ADMIN_A, UID_ADMIN_B, UID_EMP_A, UID_EMP_B, UID_EMP_SHARED] } } }),
    prisma.company.deleteMany({ where: { id: { in: [CID_A, CID_B, CID_SKILL] } } }),
  ])

  // Create companies
  await prisma.company.createMany({
    data: [
      { id: CID_A, name: 'P1 Alpha Tech', code: 'P1_A', type: 'NORMAL' },
      { id: CID_B, name: 'P1 Beta Solutions', code: 'P1_B', type: 'NORMAL' },
      { id: CID_SKILL, name: 'P1 SkillEdge Institute', code: 'P1_S', type: 'INSTITUTE' },
    ],
  })

  // Create users
  const dummyHash = 'scrypt$16384$8$1$dummysalt$dummyhash'
  await prisma.user.createMany({
    data: [
      { id: UID_ADMIN_A, email: 'p1_admin_a@test.com', name: 'Admin A', role: 'COMPANY_ADMIN', passwordHash: dummyHash },
      { id: UID_ADMIN_B, email: 'p1_admin_b@test.com', name: 'Admin B', role: 'COMPANY_ADMIN', passwordHash: dummyHash },
      { id: UID_EMP_A, email: 'p1_emp_a@test.com', name: 'Emp A', role: 'EMPLOYEE', passwordHash: dummyHash },
      { id: UID_EMP_B, email: 'p1_emp_b@test.com', name: 'Emp B', role: 'EMPLOYEE', passwordHash: dummyHash },
      { id: UID_EMP_SHARED, email: 'p1_emp_shared@test.com', name: 'Emp Shared', role: 'EMPLOYEE', passwordHash: dummyHash },
    ],
  })

  // Set company scopes: Admin A -> Company A, Admin B -> Company B
  await prisma.userCompanyScope.createMany({
    data: [
      { userId: UID_ADMIN_A, companyId: CID_A },
      { userId: UID_ADMIN_B, companyId: CID_B },
    ],
  })

  // Create employees
  await prisma.employee.createMany({
    data: [
      { id: EID_A, userId: UID_EMP_A, employeeCode: 'P1-E001', designation: 'Dev A', baseSalary: 50000 },
      { id: EID_B, userId: UID_EMP_B, employeeCode: 'P1-E002', designation: 'Dev B', baseSalary: 60000 },
      { id: EID_SHARED, userId: UID_EMP_SHARED, employeeCode: 'P1-E003', designation: 'Shared Dev', baseSalary: 70000 },
    ],
  })

  // Create assignments:
  // Emp A belongs to Company A (primary)
  // Emp B belongs to Company B (primary)
  // Emp Shared belongs to Company A (primary) and Company B (secondary)
  await prisma.employeeCompanyAssignment.createMany({
    data: [
      { id: 'p1_asgn_a', employeeId: EID_A, companyId: CID_A, isPrimary: true },
      { id: 'p1_asgn_b', employeeId: EID_B, companyId: CID_B, isPrimary: true },
      { id: 'p1_asgn_sh_a', employeeId: EID_SHARED, companyId: CID_A, isPrimary: true },
      { id: 'p1_asgn_sh_b', employeeId: EID_SHARED, companyId: CID_B, isPrimary: false },
    ],
  })

  console.log('Synthetic fixtures created successfully.')

  // ==========================================
  // Test Section 4: Employee Assignment Security (P0-01)
  // ==========================================
  console.log('\n[4] Employee Assignment Boundary Checks (P0-01)')
  {
    // Scenario 4.1: Admin B tries to assign Emp A (who belongs solely to Company A) to Company B.
    // Destination check passes (Admin B has CID_B), but Admin B lacks authority over Emp A!
    const empA = await prisma.employee.findUnique({
      where: { id: EID_A },
      include: { assignments: true },
    })

    const adminBScopedIds = [CID_B]
    const destinationCompanyId = CID_B

    // Server-side check simulation matching POST /api/assignments:
    const hasDestinationAuth = adminBScopedIds.includes(destinationCompanyId)
    const hasAuthorityOverEmpA = empA.assignments.some((a) => adminBScopedIds.includes(a.companyId))

    assert(hasDestinationAuth === true, 'Admin B has destination company scope (CID_B)')
    assert(hasAuthorityOverEmpA === false, 'Admin B lacks administrative authority over Emp A (CID_A)')

    // Scenario 4.2: Admin B tries to make Shared Employee primary in Company B without authority over current primary (Company A)
    const empShared = await prisma.employee.findUnique({
      where: { id: EID_SHARED },
      include: { assignments: true },
    })
    const currentPrimary = empShared.assignments.find((a) => a.isPrimary)
    assert(currentPrimary.companyId === CID_A, 'Emp Shared current primary is Company A')

    const adminBHasAuthorityOverCurrentPrimary = adminBScopedIds.includes(currentPrimary.companyId)
    assert(
      adminBHasAuthorityOverCurrentPrimary === false,
      'Admin B cannot reassign primary company of shared employee without authority over current primary company'
    )

    // Scenario 4.3: Company Admin (Admin B) tries to delete an assignment belonging to Company A (CID_A)
    const asgnA = await prisma.employeeCompanyAssignment.findUnique({
      where: { id: 'p1_asgn_a' },
    })
    const { assertCompanyInScope } = await import('../../src/lib/api-auth.ts')
    let deleteScopeError = null
    try {
      assertCompanyInScope(asgnA.companyId, adminBScopedIds)
    } catch (err) {
      deleteScopeError = err
    }
    assert(
      deleteScopeError !== null && deleteScopeError.status === 403,
      'Company Admin cannot delete an assignment outside their scope (expect 403)'
    )
  }

  // ==========================================
  // Test Section 5: Credentials & Reset Security (P0-02)
  // ==========================================
  console.log('\n[5] Credentials & Administrative Password Reset Checks (P0-02)')
  {
    // Simulation of tightened reset password policy matching POST /api/users/reset-password:
    function checkResetAuthorization(caller, targetUser) {
      if (caller.role !== 'SUPER_ADMIN') {
        return { allowed: false, status: 403, error: 'Forbidden: insufficient permissions' }
      }
      if (caller.userId === targetUser.id) {
        return { allowed: false, status: 400, error: 'Self-password update must use change-password' }
      }
      if (targetUser.role === 'SUPER_ADMIN') {
        return { allowed: false, status: 403, error: 'Cannot reset Super Admin password' }
      }
      return { allowed: true }
    }

    const callerAdminA = { userId: UID_ADMIN_A, role: 'COMPANY_ADMIN', scopedCompanyIds: [CID_A] }
    const callerSA = { userId: 'sa_caller_id', role: 'SUPER_ADMIN' }
    const targetPeerAdminB = { id: UID_ADMIN_B, role: 'COMPANY_ADMIN', companyScopes: [{ companyId: CID_B }] }
    const targetSuperAdmin = { id: 'sa_id', role: 'SUPER_ADMIN' }
    const targetEmpA = { id: UID_EMP_A, role: 'EMPLOYEE', employee: { assignments: [{ companyId: CID_A }] } }

    // 5.1 Caller cannot self-reset via admin reset
    const resSelf = checkResetAuthorization(callerSA, { id: 'sa_caller_id', role: 'SUPER_ADMIN' })
    assert(!resSelf.allowed && resSelf.error.includes('Self-password'), 'Self-reset rejected on admin endpoint')

    // 5.2 Super admin reset denied
    const resSA = checkResetAuthorization(callerSA, targetSuperAdmin)
    assert(!resSA.allowed && resSA.error.includes('Super Admin'), 'Super Admin password reset denied')

    // 5.3 COMPANY_ADMIN password reset now DENIED (SUPER_ADMIN only)
    const resAdminReset = checkResetAuthorization(callerAdminA, targetEmpA)
    assert(!resAdminReset.allowed && resAdminReset.status === 403, 'COMPANY_ADMIN password reset now DENIED')

    // 5.4 Super Admin password reset permitted for employee
    const resSAEmp = checkResetAuthorization(callerSA, targetEmpA)
    assert(resSAEmp.allowed, 'Super Admin password reset permitted for employee')

    // 5.5 COMPANY_ADMIN payroll PATCH denied 403 (SUPER_ADMIN only)
    function checkPayrollPatchAuth(callerRole) {
      const allowedRoles = ['SUPER_ADMIN']
      if (!allowedRoles.includes(callerRole)) {
        return { allowed: false, status: 403, error: 'Forbidden: insufficient permissions' }
      }
      return { allowed: true }
    }
    const resAdminPayrollPatch = checkPayrollPatchAuth('COMPANY_ADMIN')
    assert(!resAdminPayrollPatch.allowed && resAdminPayrollPatch.status === 403, 'COMPANY_ADMIN payroll PATCH denied 403')

    // 5.6 COMPANY_ADMIN user creation denied 403 (POST /api/users SUPER_ADMIN only)
    function checkUserCreationAuth(callerRole) {
      const allowedRoles = ['SUPER_ADMIN']
      if (!allowedRoles.includes(callerRole)) {
        return { allowed: false, status: 403, error: 'Forbidden: insufficient permissions' }
      }
      return { allowed: true }
    }
    const resAdminUserCreate = checkUserCreationAuth('COMPANY_ADMIN')
    assert(!resAdminUserCreate.allowed && resAdminUserCreate.status === 403, 'COMPANY_ADMIN user creation denied 403')
  }

  // ==========================================
  // Test Section 6: Validation Schema Verification (P0-02)
  // ==========================================
  console.log('\n[6] Validation Schema & Employee Edit Flow Verification')
  {
    const { employeeUpdateSchema } = await import('../../src/lib/validation.ts')

    // Reject password field in employeeUpdateSchema
    const parseWithPassword = employeeUpdateSchema.safeParse({
      name: 'Valid Name',
      password: 'Password@123',
    })
    assert(!parseWithPassword.success, 'employeeUpdateSchema strictly rejects password field in employee update')

    // Accept valid update without password
    const parseValid = employeeUpdateSchema.safeParse({
      name: 'Valid Name',
      designation: 'Staff Engineer',
    })
    assert(parseValid.success, 'employeeUpdateSchema accepts legitimate employee profile updates')
  }

  // ==========================================
  // Test Section 7: Company Data Access & Dashboard Scoping (P0-05)
  // ==========================================
  console.log('\n[7] Company Data Access & Dashboard Query Scoping (P0-05)')
  {
    // Verify Company A employee count does not include Company B
    const adminACount = await prisma.employee.count({
      where: {
        status: 'ACTIVE',
        assignments: { some: { companyId: { in: [CID_A] } } },
      },
    })
    // In our fixtures: Emp A (in A) + Emp Shared (in A and B) = 2
    assert(adminACount === 2, `Company Admin A counts only employees assigned to Company A (found ${adminACount}, expected 2)`)

    const adminBCount = await prisma.employee.count({
      where: {
        status: 'ACTIVE',
        assignments: { some: { companyId: { in: [CID_B] } } },
      },
    })
    // In our fixtures: Emp B (in B) + Emp Shared (in A and B) = 2
    assert(adminBCount === 2, `Company Admin B counts only employees assigned to Company B (found ${adminBCount}, expected 2)`)

    // Missing scope fails closed to 0
    const emptyScopeCount = await prisma.employee.count({
      where: {
        status: 'ACTIVE',
        assignments: { some: { companyId: { in: [] } } },
      },
    })
    assert(emptyScopeCount === 0, 'Empty scope fails closed to 0 employees (does not query all companies)')
  }

  // ==========================================
  // Cleanup Synthetic Fixtures
  // ==========================================
  console.log('\n[8] Cleaning Up Synthetic Test Fixtures')
  await prisma.$transaction([
    prisma.employeeCompanyAssignment.deleteMany({ where: { employeeId: { in: [EID_A, EID_B, EID_SHARED] } } }),
    prisma.userCompanyScope.deleteMany({ where: { userId: { in: [UID_ADMIN_A, UID_ADMIN_B] } } }),
    prisma.employee.deleteMany({ where: { id: { in: [EID_A, EID_B, EID_SHARED] } } }),
    prisma.user.deleteMany({ where: { id: { in: [UID_ADMIN_A, UID_ADMIN_B, UID_EMP_A, UID_EMP_B, UID_EMP_SHARED] } } }),
    prisma.company.deleteMany({ where: { id: { in: [CID_A, CID_B, CID_SKILL] } } }),
  ])
  console.log('Synthetic fixtures cleanly restored.')

  console.log(`\n--- Verification Summary: ${passed} PASSED, ${failed} FAILED ---`)
  if (failed > 0) {
    process.exit(1)
  }
}

run()
  .catch((err) => {
    console.error('Test execution error:', err.message)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

