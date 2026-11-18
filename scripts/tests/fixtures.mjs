// scripts/tests/fixtures.mjs
// Deterministic test fixture seeding for unihr_test database.
// Executes under a single interactive transaction with fail-closed safety gate.

import { PrismaClient } from '@prisma/client'
import { scryptSync, timingSafeEqual } from 'node:crypto'

// =================================================================
// 1. SAFETY GATE: Environment & Target Isolation Checks
// =================================================================

const testUrl = process.env.TEST_DATABASE_URL
if (!testUrl) {
  console.error('GATE FAIL: TEST_DATABASE_URL environment variable is missing.')
  process.exit(1)
}

// Never read or allow fallback to operational DATABASE_URL
const EXPECTED_DB = 'unihr_test'
const EXPECTED_USER = 'unihr_tester'
const EXPECTED_HOST = '172.19.0.2'

const prisma = new PrismaClient({ datasourceUrl: testUrl })

async function verifyGate(client, contextLabel) {
  const rows = await client.$queryRawUnsafe(
    'SELECT current_database() AS db, inet_server_addr() AS host, current_user AS usr'
  )
  const { db, host, usr } = rows[0]
  const hostNorm = String(host).replace(/\/32$/, '')

  if (db !== EXPECTED_DB) {
    throw new Error(`GATE FAIL (${contextLabel}): current_database()='${db}', expected '${EXPECTED_DB}'`)
  }
  if (usr !== EXPECTED_USER) {
    throw new Error(`GATE FAIL (${contextLabel}): current_user='${usr}', expected '${EXPECTED_USER}'`)
  }
  if (hostNorm !== EXPECTED_HOST) {
    throw new Error(`GATE FAIL (${contextLabel}): inet_server_addr()='${hostNorm}', expected '${EXPECTED_HOST}'`)
  }

  return { db, host: hostNorm, usr }
}

// =================================================================
// 2. DETERMINISTIC PASSWORD HASHING
// =================================================================

const FIXTURE_SALT = '00112233445566778899aabbccddeeff'
const FIXTURE_PASSWORD = 'Tst#Unihr2026'
const derivedHash = scryptSync(FIXTURE_PASSWORD, FIXTURE_SALT, 64).toString('hex')
const DETERMINISTIC_PASSWORD_HASH = `${FIXTURE_SALT}:${derivedHash}`

// Verify compatibility against application verifyPassword implementation locally
function verifyCompatibility(password, stored) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const hashBuf = Buffer.from(hash, 'hex')
  const testBuf = scryptSync(password, salt, 64)
  return hashBuf.length === testBuf.length && timingSafeEqual(hashBuf, testBuf)
}

if (!verifyCompatibility(FIXTURE_PASSWORD, DETERMINISTIC_PASSWORD_HASH)) {
  console.error('FATAL: Deterministic password verification self-test failed.')
  process.exit(1)
}

// =================================================================
// 3. EXECUTION: Interactive Transaction & Assertions
// =================================================================

async function main() {
  console.log('--- UniHR P6 Fixture Seeding: Safety Gate Verification ---')
  const preGate = await verifyGate(prisma, 'pre-transaction')
  console.log(`GATE PASS: db=${preGate.db}, host=${preGate.host}, user=${preGate.usr} (unihr_test confirmed)`)

  console.log('\n--- Beginning Single Interactive Transaction ---')
  await prisma.$transaction(
    async (tx) => {
      // Re-verify gate inside the transaction immediately before write operations
      await verifyGate(tx, 'in-transaction')

      // Discover all public base tables from PostgreSQL catalog
      const tableRows = await tx.$queryRawUnsafe(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename ASC"
      )
      const allPublicTables = tableRows
        .map((r) => r.tablename)
        .filter((name) => !name.startsWith('_prisma_'))

      console.log(`Discovered ${allPublicTables.length} public application tables in unihr_test.`)

      // TRUNCATE all discovered tables with CASCADE
      const quotedTables = allPublicTables.map((t) => `"${t}"`).join(', ')
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${quotedTables} CASCADE;`)
      console.log('TRUNCATE TABLE executed with CASCADE across all discovered tables.')

      // Post-TRUNCATE zero-row assertion across every table
      const postTruncateCounts = {}
      for (const tbl of allPublicTables) {
        const countRes = await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${tbl}"`)
        const count = countRes[0].n
        postTruncateCounts[tbl] = count
        if (count !== 0) {
          throw new Error(`TRUNCATE FAIL: Table "${tbl}" has ${count} rows, expected 0.`)
        }
      }
      console.log('Post-TRUNCATE zero-row verification: ALL 27 tables confirmed empty (0 rows).')

      // -------------------------------------------------------------
      // Canonical Fixture Inserts
      // -------------------------------------------------------------
      console.log('\n--- Inserting Canonical Fixture Records ---')

      // 6.1 Companies (2)
      await tx.company.createMany({
        data: [
          { id: 'tst_cmp_a', name: 'Alpha Corp (TEST)', code: 'ALPHA', type: 'NORMAL' },
          { id: 'tst_cmp_b', name: 'Beta Ltd (TEST)', code: 'BETA', type: 'NORMAL' },
        ],
      })

      // 6.2 Users (11)
      await tx.user.createMany({
        data: [
          { id: 'tst_usr_sa', email: 'sa@test.local', name: 'Super Admin', role: 'SUPER_ADMIN', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: true },
          { id: 'tst_usr_adminA', email: 'adminA@test.local', name: 'Admin Alpha', role: 'COMPANY_ADMIN', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: true },
          { id: 'tst_usr_adminB', email: 'adminB@test.local', name: 'Admin Beta', role: 'COMPANY_ADMIN', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: true },
          { id: 'tst_usr_hrA', email: 'hrA@test.local', name: 'HR Alpha', role: 'HR', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: true },
          { id: 'tst_usr_mgrA', email: 'mgrA@test.local', name: 'Manager Alpha', role: 'MANAGER', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: true },
          { id: 'tst_usr_empA1', email: 'empA1@test.local', name: 'Employee A1', role: 'EMPLOYEE', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: true },
          { id: 'tst_usr_empA2', email: 'empA2@test.local', name: 'Employee A2', role: 'EMPLOYEE', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: true },
          { id: 'tst_usr_empShared', email: 'empShared@test.local', name: 'Shared Employee', role: 'EMPLOYEE', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: true },
          { id: 'tst_usr_empB', email: 'empB@test.local', name: 'Employee B', role: 'EMPLOYEE', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: true },
          { id: 'tst_usr_student', email: 'student@test.local', name: 'Student User', role: 'STUDENT', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: true },
          { id: 'tst_usr_dead', email: 'dead@test.local', name: 'Inactive User', role: 'EMPLOYEE', passwordHash: DETERMINISTIC_PASSWORD_HASH, isActive: false },
        ],
      })

      // 6.3 Employees (6)
      await tx.employee.createMany({
        data: [
          { id: 'tst_emp_mgrA', employeeCode: 'TST-0001', userId: 'tst_usr_mgrA', managerId: null, designation: 'Manager', status: 'ACTIVE', baseSalary: 120000.00 },
          { id: 'tst_emp_a1', employeeCode: 'TST-0002', userId: 'tst_usr_empA1', managerId: 'tst_emp_mgrA', designation: 'Engineer', status: 'ACTIVE', baseSalary: 70000.00 },
          { id: 'tst_emp_a2', employeeCode: 'TST-0003', userId: 'tst_usr_empA2', managerId: 'tst_emp_mgrA', designation: 'QA Engineer', status: 'ACTIVE', baseSalary: 60000.00 },
          { id: 'tst_emp_shared', employeeCode: 'TST-0004', userId: 'tst_usr_empShared', managerId: null, designation: 'Shared Engineer', status: 'ACTIVE', baseSalary: 85000.00 },
          { id: 'tst_emp_b', employeeCode: 'TST-0005', userId: 'tst_usr_empB', managerId: null, designation: 'Support Specialist', status: 'ACTIVE', baseSalary: 65000.00 },
          { id: 'tst_emp_dead', employeeCode: 'TST-0006', userId: 'tst_usr_dead', managerId: null, designation: 'Former Employee', status: 'ACTIVE', baseSalary: 50000.00 },
        ],
      })

      // 6.4 EmployeeCompanyAssignment (7)
      await tx.employeeCompanyAssignment.createMany({
        data: [
          { id: 'tst_asg_mgrA_a', employeeId: 'tst_emp_mgrA', companyId: 'tst_cmp_a', isPrimary: true, designation: null },
          { id: 'tst_asg_a1_a', employeeId: 'tst_emp_a1', companyId: 'tst_cmp_a', isPrimary: true, designation: null },
          { id: 'tst_asg_a2_a', employeeId: 'tst_emp_a2', companyId: 'tst_cmp_a', isPrimary: true, designation: null },
          { id: 'tst_asg_shared_a', employeeId: 'tst_emp_shared', companyId: 'tst_cmp_a', isPrimary: true, designation: null },
          { id: 'tst_asg_shared_b', employeeId: 'tst_emp_shared', companyId: 'tst_cmp_b', isPrimary: false, designation: null },
          { id: 'tst_asg_b_b', employeeId: 'tst_emp_b', companyId: 'tst_cmp_b', isPrimary: true, designation: null },
          { id: 'tst_asg_dead_a', employeeId: 'tst_emp_dead', companyId: 'tst_cmp_a', isPrimary: true, designation: null },
        ],
      })

      // 6.5 UserCompanyScope (3)
      await tx.userCompanyScope.createMany({
        data: [
          { id: 'tst_scope_adminA_a', userId: 'tst_usr_adminA', companyId: 'tst_cmp_a' },
          { id: 'tst_scope_hrA_a', userId: 'tst_usr_hrA', companyId: 'tst_cmp_a' },
          { id: 'tst_scope_adminB_b', userId: 'tst_usr_adminB', companyId: 'tst_cmp_b' },
        ],
      })

      // 6.6 LeaveTypes (4)
      await tx.leaveType.createMany({
        data: [
          { id: 'tst_lt_a_annual', companyId: 'tst_cmp_a', name: 'Annual Leave', daysPerYear: 12 },
          { id: 'tst_lt_a_sick', companyId: 'tst_cmp_a', name: 'Sick Leave', daysPerYear: 10 },
          { id: 'tst_lt_b_annual', companyId: 'tst_cmp_b', name: 'Annual Leave', daysPerYear: 14 },
          { id: 'tst_lt_b_sick', companyId: 'tst_cmp_b', name: 'Sick Leave', daysPerYear: 5 },
        ],
      })

      // 6.7 LeaveRequests (2)
      await tx.leaveRequest.createMany({
        data: [
          {
            id: 'tst_lv_pending',
            employeeId: 'tst_emp_a1',
            leaveTypeId: 'tst_lt_a_annual',
            startDate: new Date('2026-02-10T00:00:00.000Z'),
            endDate: new Date('2026-02-12T00:00:00.000Z'),
            days: 3,
            reason: 'Annual leave for family commitments',
            status: 'PENDING',
            reviewedById: 'tst_usr_hrA',
            reviewedAt: null,
          },
          {
            id: 'tst_lv_approved',
            employeeId: 'tst_emp_a1',
            leaveTypeId: 'tst_lt_a_sick',
            startDate: new Date('2026-02-03T00:00:00.000Z'),
            endDate: new Date('2026-02-05T00:00:00.000Z'),
            days: 3,
            reason: 'Medical sick leave',
            status: 'APPROVED',
            reviewedById: 'tst_usr_hrA',
            reviewedAt: new Date('2026-02-02T15:00:00.000Z'),
          },
        ],
      })

      console.log('Fixture inserts complete.')

      // -------------------------------------------------------------
      // 7. Post-Seed Count Assertions
      // -------------------------------------------------------------
      console.log('\n--- Running Post-Seed Model Count Assertions ---')
      const EXPECTED_COUNTS = {
        Company: 2,
        User: 11,
        Employee: 6,
        EmployeeCompanyAssignment: 7,
        UserCompanyScope: 3,
        LeaveType: 4,
        LeaveRequest: 2,
      }

      const postSeedCounts = {}
      for (const tbl of allPublicTables) {
        const countRes = await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${tbl}"`)
        const count = countRes[0].n
        postSeedCounts[tbl] = count
        const expected = EXPECTED_COUNTS[tbl] ?? 0
        if (count !== expected) {
          throw new Error(`COUNT ASSERTION FAIL: Model "${tbl}" has ${count} rows, expected ${expected}.`)
        }
      }
      console.log('Post-seed count assertions passed for all 27 tables.')

      // -------------------------------------------------------------
      // Relationship & Domain Assertions
      // -------------------------------------------------------------
      console.log('\n--- Running Relationship & Domain Assertions ---')
      const assertions = []

      function assertCondition(id, condition, description) {
        if (!condition) {
          throw new Error(`RELATIONSHIP ASSERTION FAIL [${id}]: ${description}`)
        }
        assertions.push({ id, status: 'PASS', description })
        console.log(`PASS: [${id}] ${description}`)
      }

      // 1-3. Shared employee assignments
      const sharedAsgs = await tx.employeeCompanyAssignment.findMany({
        where: { employeeId: 'tst_emp_shared' },
      })
      assertCondition(
        'R-01',
        sharedAsgs.length === 2 &&
          sharedAsgs.some((a) => a.companyId === 'tst_cmp_a') &&
          sharedAsgs.some((a) => a.companyId === 'tst_cmp_b'),
        'tst_emp_shared has exactly two assignments: Alpha and Beta'
      )

      const alphaAsg = sharedAsgs.find((a) => a.companyId === 'tst_cmp_a')
      assertCondition('R-02', alphaAsg?.isPrimary === true, 'The Alpha assignment is primary')

      const betaAsg = sharedAsgs.find((a) => a.companyId === 'tst_cmp_b')
      assertCondition('R-03', betaAsg?.isPrimary === false, 'The Beta assignment is non-primary')

      // 4-6. Manager linkages
      const empA1 = await tx.employee.findUnique({ where: { id: 'tst_emp_a1' } })
      assertCondition('R-04', empA1?.managerId === 'tst_emp_mgrA', 'tst_emp_a1.managerId = tst_emp_mgrA')

      const empA2 = await tx.employee.findUnique({ where: { id: 'tst_emp_a2' } })
      assertCondition('R-05', empA2?.managerId === 'tst_emp_mgrA', 'tst_emp_a2.managerId = tst_emp_mgrA')

      const empShared = await tx.employee.findUnique({ where: { id: 'tst_emp_shared' } })
      assertCondition('R-06', empShared?.managerId === null, 'tst_emp_shared.managerId = null')

      // 7-10. UserCompanyScopes
      const adminAScopes = await tx.userCompanyScope.findMany({ where: { userId: 'tst_usr_adminA' } })
      assertCondition(
        'R-07',
        adminAScopes.length === 1 && adminAScopes[0].companyId === 'tst_cmp_a',
        'Admin A scope is exactly Alpha'
      )

      const hrAScopes = await tx.userCompanyScope.findMany({ where: { userId: 'tst_usr_hrA' } })
      assertCondition(
        'R-08',
        hrAScopes.length === 1 && hrAScopes[0].companyId === 'tst_cmp_a',
        'HR A scope is exactly Alpha'
      )

      const adminBScopes = await tx.userCompanyScope.findMany({ where: { userId: 'tst_usr_adminB' } })
      assertCondition(
        'R-09',
        adminBScopes.length === 1 && adminBScopes[0].companyId === 'tst_cmp_b',
        'Admin B scope is exactly Beta'
      )

      const totalScopes = await tx.userCompanyScope.count()
      assertCondition('R-10', totalScopes === 3, 'No unintended UserCompanyScope records exist')

      // 11. LeaveType company mapping
      const ltBAnnual = await tx.leaveType.findUnique({ where: { id: 'tst_lt_b_annual' } })
      assertCondition('R-11', ltBAnnual?.companyId === 'tst_cmp_b', 'tst_lt_b_annual.companyId = tst_cmp_b')

      // 12-13. Deactivated user & assignment
      const deadUser = await tx.user.findUnique({ where: { id: 'tst_usr_dead' } })
      assertCondition('R-12', deadUser?.isActive === false, 'dead@test.local is inactive')

      const deadAsgs = await tx.employeeCompanyAssignment.findMany({ where: { employeeId: 'tst_emp_dead' } })
      assertCondition(
        'R-13',
        deadAsgs.length === 1 && deadAsgs[0].companyId === 'tst_cmp_a',
        "The inactive user's employee assignment still exists"
      )

      // 14-15. LeaveRequests exact fields and status enum check
      const pendingLv = await tx.leaveRequest.findUnique({ where: { id: 'tst_lv_pending' } })
      const approvedLv = await tx.leaveRequest.findUnique({ where: { id: 'tst_lv_approved' } })

      const VALID_LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']

      assertCondition(
        'R-14',
        pendingLv?.employeeId === 'tst_emp_a1' &&
          pendingLv?.leaveTypeId === 'tst_lt_a_annual' &&
          pendingLv?.status === 'PENDING' &&
          pendingLv?.reviewedById === 'tst_usr_hrA' &&
          pendingLv?.days === 3 &&
          approvedLv?.employeeId === 'tst_emp_a1' &&
          approvedLv?.leaveTypeId === 'tst_lt_a_sick' &&
          approvedLv?.status === 'APPROVED' &&
          approvedLv?.reviewedById === 'tst_usr_hrA' &&
          approvedLv?.days === 3,
        'Both LeaveRequests have exact expected IDs, employee, leave type, dates, days, status, and reviewer'
      )

      assertCondition(
        'R-15',
        VALID_LEAVE_STATUSES.includes(pendingLv?.status) && VALID_LEAVE_STATUSES.includes(approvedLv?.status),
        "Both LeaveRequest statuses are valid values from application's LEAVE_STATUS"
      )

      // 16-17. Password format and safety
      const allUsers = await tx.user.findMany({ select: { id: true, email: true, passwordHash: true } })
      const allPassFormatsValid = allUsers.every(
        (u) =>
          u.passwordHash &&
          u.passwordHash.startsWith(`${FIXTURE_SALT}:`) &&
          u.passwordHash.length === 32 + 1 + 128
      )
      assertCondition(
        'R-16',
        allPassFormatsValid && allUsers.length === 11,
        'All 11 password fields are non-empty and use the expected hash format'
      )

      const noPlaintext = allUsers.every((u) => u.passwordHash !== FIXTURE_PASSWORD)
      assertCondition('R-17', noPlaintext, 'No plaintext password is stored')

      // 18. Student has no Employee record
      const studentUser = await tx.user.findUnique({
        where: { id: 'tst_usr_student' },
        include: { employee: true },
      })
      assertCondition('R-18', studentUser?.employee === null, 'STUDENT has no Employee record')

      // 19. Superadmin has no Employee record and no explicit UserCompanyScope
      const saUser = await tx.user.findUnique({
        where: { id: 'tst_usr_sa' },
        include: { employee: true, companyScopes: true },
      })
      assertCondition(
        'R-19',
        saUser?.employee === null && saUser?.companyScopes?.length === 0,
        'SUPER_ADMIN has no Employee record and no explicit UserCompanyScope'
      )

      // 20. Zero rows in all other models
      const nonSeedModels = allPublicTables.filter((tbl) => !EXPECTED_COUNTS[tbl])
      const allNonSeedZero = nonSeedModels.every((tbl) => postSeedCounts[tbl] === 0)
      assertCondition('R-20', allNonSeedZero, 'No unexpected rows exist in any other model')
    },
    { timeout: 30000, maxWait: 15000 }
  )

  console.log('\n========================================')
  console.log('P6 SEED OK: Transaction committed successfully.')
  console.log('========================================')
}

main()
  .catch((err) => {
    console.error('\nFATAL ERROR DURING FIXTURE SEEDING:')
    console.error(err.message)
    console.error('Transactional rollback enforced. Previous database state preserved.')
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

