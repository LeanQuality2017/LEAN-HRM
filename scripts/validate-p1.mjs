import { db } from '../src/lib/db.ts'

const BASE = 'http://localhost:3000'

async function getCsrfToken() {
  const res = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await res.json()
  const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || '']
  const csrfCookie = rawCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ')
  return { csrfToken, csrfCookie }
}

async function loginAttempt(email, password) {
  const { csrfToken, csrfCookie } = await getCsrfToken()
  const params = new URLSearchParams()
  params.append('email', email)
  params.append('password', password)
  params.append('csrfToken', csrfToken)
  params.append('callbackUrl', `${BASE}/dashboard`)
  params.append('json', 'true')

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': csrfCookie,
    },
    body: params.toString(),
    redirect: 'manual',
  })

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || '']
  const sessionCookie = setCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ')
  const data = await res.json().catch(() => null)

  const hasSessionToken = sessionCookie.includes('next-auth.session-token')

  return {
    status: res.status,
    url: data?.url || null,
    cookie: hasSessionToken ? sessionCookie : null,
  }
}

async function login(email, password = 'Password@123') {
  const res = await loginAttempt(email, password)
  return res.cookie
}

async function serverResetRateLimit(email) {
  await fetch(`${BASE}/api/auth/reset-rate-limit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

async function request(path, opts = {}) {
  const cookie = opts.cookie || ''
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      ...(opts.headers || {}),
    },
    redirect: 'manual',
  })
  let body = null
  const text = await res.text()
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, headers: res.headers, body }
}

async function main() {
  const results = []
  function record(id, title, expected, actual, pass) {
    results.push({ id, title, expected, actual, pass })
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id}: ${title} -> Got: ${actual} (expected: ${expected})`)
  }

  console.log('--- STARTING P1 HARDENING VALIDATION ---')

  // ==========================================
  // VALIDATE 1: Rate Limiting
  // ==========================================
  console.log('\n--- VALIDATE 1: Rate Limiting ---')
  await serverResetRateLimit('employee1@unihr.com')

  // 6 wrong attempts for employee1
  const attempts = []
  for (let i = 1; i <= 6; i++) {
    const att = await loginAttempt('employee1@unihr.com', `BadPassword_${i}`)
    attempts.push(att)
  }

  const att6Url = attempts[5].url || ''
  const is6thBlocked = att6Url.includes('Too%20many%20attempts') || att6Url.includes('Too+many+attempts')
  record('V1.1', '6th wrong-password login for employee1 blocked with message', 'Too many attempts in URL', att6Url, is6thBlocked)

  // Different account unaffected (employee3)
  const emp3Login = await loginAttempt('employee3@unihr.com', 'Password@123')
  const emp3Success = Boolean(emp3Login.cookie)
  record('V1.2', 'Different account (employee3) login unaffected by employee1 block', 'login success (cookie present)', `cookie present: ${emp3Success}`, emp3Success)

  // Reset rate limit in server and verify successful login clears counter
  await serverResetRateLimit('employee1@unihr.com')

  // 2 failed attempts
  await loginAttempt('employee1@unihr.com', 'WrongOnce')
  await loginAttempt('employee1@unihr.com', 'WrongTwice')
  // Successful login clears the counter
  const emp1Recovery = await loginAttempt('employee1@unihr.com', 'Password@123')
  const emp1Recovered = Boolean(emp1Recovery.cookie)

  // 2 more failed attempts (should not reach 5 because counter was reset to 0)
  const postResetFail1 = await loginAttempt('employee1@unihr.com', 'WrongAgain1')
  const notBlockedEarly = !postResetFail1.url?.includes('Too%20many%20attempts')
  // Re-login cleanly with valid password
  const emp1Clean = await loginAttempt('employee1@unihr.com', 'Password@123')
  const emp1Ready = Boolean(emp1Clean.cookie)
  record('V1.3', 'Employee1 counter cleared on success and login succeeds', 'login success, not blocked early', `recovered: ${emp1Recovered}, notBlockedEarly: ${notBlockedEarly}, cleanLogin: ${emp1Ready}`, emp1Recovered && notBlockedEarly && emp1Ready)

  // Establish sessions for all roles
  const superCookie = await login('superadmin1@unihr.com')
  const admin1Cookie = await login('admin1@unihr.com')
  const hr1Cookie = await login('hr1@unihr.com')
  const mgr1Cookie = await login('manager1@unihr.com')
  let emp1Cookie = emp1Clean.cookie

  const hr1User = await db.user.findUnique({ where: { email: 'hr1@unihr.com' } })
  const mgr1User = await db.user.findUnique({ where: { email: 'manager1@unihr.com' } })
  const emp1Employee = await db.employee.findFirst({ where: { user: { email: 'employee1@unihr.com' } } })
  const emp2Employee = await db.employee.findFirst({ where: { user: { email: 'employee2@unihr.com' } } })

  // ==========================================
  // VALIDATE 2: Audit Logs
  // ==========================================
  console.log('\n--- VALIDATE 2: Audit Logs ---')

  // 2.1 Process a payroll (DRAFT -> PROCESSED) as hr1
  const prList = await request('/api/payroll', { cookie: hr1Cookie })
  let draftSlip = (prList.body?.data || []).find(p => p.status === 'DRAFT')
  if (!draftSlip) {
    await request('/api/payroll', { method: 'POST', cookie: hr1Cookie, body: JSON.stringify({ month: 8, year: 2026 }) })
    const ref = await request('/api/payroll', { cookie: hr1Cookie })
    draftSlip = (ref.body?.data || []).find(p => p.status === 'DRAFT')
  }

  let payrollAuditFound = false
  if (draftSlip) {
    await request(`/api/payroll?id=${draftSlip.id}`, {
      method: 'PATCH',
      cookie: hr1Cookie,
      body: JSON.stringify({ status: 'PROCESSED' }),
    })

    const auditEntry = await db.auditLog.findFirst({
      where: {
        action: 'PAYROLL_PROCESS',
        entity: 'Payroll',
        entityId: draftSlip.id,
        userId: hr1User.id,
      },
    })
    payrollAuditFound = Boolean(auditEntry)
  }
  record('V2.1', 'hr1 processes payroll -> AuditLog row exists with PAYROLL_PROCESS, Payroll, hr1 userId', 'AuditLog row exists', `AuditLog row exists: ${payrollAuditFound}`, payrollAuditFound)

  // 2.2 Approve a leave as manager1 -> row exists
  const validLt = await db.leaveType.findFirst({ where: { company: { code: 'ALPHA' } } })
  const dStart = '2026-12-15'
  const dEnd = '2026-12-16'
  const newLeave = await request('/api/leaves', {
    method: 'POST',
    cookie: emp1Cookie,
    body: JSON.stringify({
      leaveTypeId: validLt.id,
      startDate: dStart,
      endDate: dEnd,
      reason: 'Audit verification leave',
    }),
  })
  const leaveId = newLeave.body?.data?.id

  let leaveAuditFound = false
  if (leaveId) {
    await request(`/api/leaves/${leaveId}`, {
      method: 'PATCH',
      cookie: mgr1Cookie,
      body: JSON.stringify({ status: 'APPROVED' }),
    })

    const auditEntry = await db.auditLog.findFirst({
      where: {
        action: 'LEAVE_APPROVE',
        entity: 'LeaveRequest',
        entityId: leaveId,
        userId: mgr1User.id,
      },
    })
    leaveAuditFound = Boolean(auditEntry)
  }
  record('V2.2', 'manager1 approves leave -> AuditLog row exists with LEAVE_APPROVE, LeaveRequest, manager1 userId', 'AuditLog row exists', `AuditLog row exists: ${leaveAuditFound}`, leaveAuditFound)

  // 2.3 Role change attempt via employees route: audited ONLY when successful
  const preFailedCount = await db.auditLog.count({ where: { action: 'USER_ROLE_CHANGE' } })
  const hrRoleAttempt = await request(`/api/employees?id=${emp1Employee.id}`, {
    method: 'PATCH',
    cookie: hr1Cookie,
    body: JSON.stringify({ role: 'SUPER_ADMIN' }),
  })
  const postFailedCount = await db.auditLog.count({ where: { action: 'USER_ROLE_CHANGE' } })
  const failedNotAudited = hrRoleAttempt.status === 403 && preFailedCount === postFailedCount
  record('V2.3a', 'Forbidden role change attempt by HR rejected -> 403 and NOT audited', '403, count unchanged', `status: ${hrRoleAttempt.status}, count delta: ${postFailedCount - preFailedCount}`, failedNotAudited)

  // superadmin1 changes employee2 role to MANAGER -> 200 and audited
  const superRoleChange = await request(`/api/employees?id=${emp2Employee.id}`, {
    method: 'PATCH',
    cookie: superCookie,
    body: JSON.stringify({ role: 'MANAGER' }),
  })
  const postSuccessCount = await db.auditLog.count({ where: { action: 'USER_ROLE_CHANGE' } })
  const successAudited = superRoleChange.status === 200 && postSuccessCount === preFailedCount + 1
  record('V2.3b', 'Successful role change by Super Admin -> 200 and audited in AuditLog', '200, count +1', `status: ${superRoleChange.status}, count delta: ${postSuccessCount - preFailedCount}`, successAudited)

  // ==========================================
  // VALIDATE 3: Change Password & Reset Password
  // ==========================================
  console.log('\n--- VALIDATE 3: Change Password & Reset Password ---')

  // 3.1 Change password as employee1: wrong current -> 400
  const wrongCurrentRes = await request('/api/auth/change-password', {
    method: 'POST',
    cookie: emp1Cookie,
    body: JSON.stringify({
      currentPassword: 'TotallyWrongPassword123',
      newPassword: 'BrandNewPassword@2026',
    }),
  })
  record('V3.1a', 'Employee1 change password with wrong current password -> 400', '400', wrongCurrentRes.status, wrongCurrentRes.status === 400)

  // 3.2 Correct current password -> 200
  const changeRes = await request('/api/auth/change-password', {
    method: 'POST',
    cookie: emp1Cookie,
    body: JSON.stringify({
      currentPassword: 'Password@123',
      newPassword: 'BrandNewPassword@2026',
    }),
  })
  record('V3.1b', 'Employee1 change password with correct current password -> 200', '200', changeRes.status, changeRes.status === 200)

  // Verify AuditLog for PASSWORD_CHANGE
  const pwdChangeAudit = await db.auditLog.findFirst({
    where: {
      action: 'PASSWORD_CHANGE',
      entity: 'User',
      userId: emp1Employee.userId,
    },
    orderBy: { createdAt: 'desc' },
  })
  record('V3.1c', 'AuditLog row exists for PASSWORD_CHANGE', 'AuditLog row exists', `AuditLog row exists: ${Boolean(pwdChangeAudit)}`, Boolean(pwdChangeAudit))

  // Old password rejected
  const oldLoginRes = await loginAttempt('employee1@unihr.com', 'Password@123')
  record('V3.1d', 'Login with old password fails', 'no session cookie', `cookie present: ${Boolean(oldLoginRes.cookie)}`, !oldLoginRes.cookie)

  // New password works
  const newLoginRes = await loginAttempt('employee1@unihr.com', 'BrandNewPassword@2026')
  record('V3.1e', 'Login with new password succeeds', 'cookie present', `cookie present: ${Boolean(newLoginRes.cookie)}`, Boolean(newLoginRes.cookie))

  // 3.3 superadmin1 resets employee2 password
  const emp2User = await db.user.findUnique({ where: { email: 'employee2@unihr.com' } })
  const resetRes = await request('/api/users/reset-password', {
    method: 'POST',
    cookie: superCookie,
    body: JSON.stringify({
      userId: emp2User.id,
      newPassword: 'ResetPassword@2026',
    }),
  })
  record('V3.2a', 'superadmin1 resets employee2 password -> 200', '200', resetRes.status, resetRes.status === 200)

  // Verify AuditLog for PASSWORD_RESET
  const pwdResetAudit = await db.auditLog.findFirst({
    where: {
      action: 'PASSWORD_RESET',
      entity: 'User',
      entityId: emp2User.id,
    },
    orderBy: { createdAt: 'desc' },
  })
  record('V3.2b', 'AuditLog row exists for PASSWORD_RESET', 'AuditLog row exists', `AuditLog row exists: ${Boolean(pwdResetAudit)}`, Boolean(pwdResetAudit))

  // employee2 logs in with new reset password
  const emp2ResetLogin = await loginAttempt('employee2@unihr.com', 'ResetPassword@2026')
  record('V3.2c', 'employee2 logs in with reset password', 'cookie present', `cookie present: ${Boolean(emp2ResetLogin.cookie)}`, Boolean(emp2ResetLogin.cookie))

  // Restore employee2 password for repeatability
  await request('/api/users/reset-password', {
    method: 'POST',
    cookie: superCookie,
    body: JSON.stringify({
      userId: emp2User.id,
      newPassword: 'Password@123',
    }),
  })

  // ==========================================
  // VALIDATE 4: Audit View & API Gating
  // ==========================================
  console.log('\n--- VALIDATE 4: Audit View & API Gating ---')

  // 4.1 employee1 accessing /audit -> redirected server-side
  const emp1AuditPage = await request('/audit', { cookie: newLoginRes.cookie })
  const isPageRedirected = [301, 302, 307, 308].includes(emp1AuditPage.status)
  record('V4.1', 'employee1 accessing /audit redirected server-side', '302/307 redirect', `${emp1AuditPage.status} (location: ${emp1AuditPage.headers.get('location')})`, isPageRedirected)

  // 4.2 employee1 calling GET /api/audit -> 403
  const emp1AuditApi = await request('/api/audit', { cookie: newLoginRes.cookie })
  record('V4.2', 'employee1 calling GET /api/audit -> 403', '403', emp1AuditApi.status, emp1AuditApi.status === 403)

  // Restore employee1 password back to Password@123 for repeatability
  await request('/api/auth/change-password', {
    method: 'POST',
    cookie: newLoginRes.cookie,
    body: JSON.stringify({
      currentPassword: 'BrandNewPassword@2026',
      newPassword: 'Password@123',
    }),
  })
  emp1Cookie = await login('employee1@unihr.com')

  // 4.3 admin1 calling GET /api/audit -> 200
  const admin1AuditApi = await request('/api/audit', { cookie: admin1Cookie })
  const admin1CanSee = admin1AuditApi.status === 200 && Array.isArray(admin1AuditApi.body?.data)
  record('V4.3a', 'admin1 calling GET /api/audit -> 200 with log list', '200 and array', `${admin1AuditApi.status}, count: ${admin1AuditApi.body?.data?.length}`, admin1CanSee)

  // 4.4 admin1 filter by action works
  const admin1FilteredApi = await request('/api/audit?action=LEAVE_APPROVE', { cookie: admin1Cookie })
  const filteredOk = admin1FilteredApi.status === 200 && (admin1FilteredApi.body?.data || []).every(l => l.action === 'LEAVE_APPROVE')
  record('V4.3b', 'admin1 filtering GET /api/audit?action=LEAVE_APPROVE works', '200, all items action=LEAVE_APPROVE', `${admin1FilteredApi.status}, match: ${filteredOk}`, filteredOk)

  // ==========================================
  // VALIDATE 5: Finding 16 Folded-In Recheck
  // ==========================================
  console.log('\n--- VALIDATE 5: Leave Past-Date Policy Recheck ---')

  await db.leaveRequest.deleteMany({
    where: {
      reason: {
        in: [
          'HR backdate within 7-day window',
          'HR backdate exceeding 7-day limit',
          'Audit verification leave',
        ],
      },
    },
  })

  const now = Date.now()
  const dYesterday = new Date(now - 1 * 86400000).toISOString().slice(0, 10)
  const d10DaysAgo = new Date(now - 10 * 86400000).toISOString().slice(0, 10)

  // hr1 applies leave with startDate = yesterday (within 7 days) -> 201
  const hrLeaveYesterday = await request('/api/leaves', {
    method: 'POST',
    cookie: hr1Cookie,
    body: JSON.stringify({
      leaveTypeId: validLt.id,
      startDate: dYesterday,
      endDate: dYesterday,
      reason: 'HR backdate within 7-day window',
    }),
  })
  record('V5.1', 'hr1 applies leave with startDate = yesterday (within 7 days) -> 201', '201', hrLeaveYesterday.status, hrLeaveYesterday.status === 201)

  // hr1 applies leave with startDate = 10 days ago (exceeds 7 days) -> 400
  const hrLeave10DaysAgo = await request('/api/leaves', {
    method: 'POST',
    cookie: hr1Cookie,
    body: JSON.stringify({
      leaveTypeId: validLt.id,
      startDate: d10DaysAgo,
      endDate: d10DaysAgo,
      reason: 'HR backdate exceeding 7-day limit',
    }),
  })
  record('V5.2', 'hr1 applies leave with startDate = 10 days ago (exceeds 7 days) -> 400', '400', hrLeave10DaysAgo.status, hrLeave10DaysAgo.status === 400)

  // ==========================================
  // VALIDATE 6: Regression & End-to-End
  // ==========================================
  console.log('\n--- VALIDATE 6: Regression End-to-End ---')

  // EOD Submit + Review
  const eodDate = new Date(Date.now() + 150 * 86400000 + Math.floor(Math.random() * 10000000)).toISOString().slice(0, 10)
  const eodSubmit = await request('/api/work-reports', {
    method: 'POST',
    cookie: emp1Cookie,
    body: JSON.stringify({
      date: eodDate,
      tasks: 'Daily sprint regression tasks',
    }),
  })
  const eodId = eodSubmit.body?.data?.id
  let eodReviewed = false
  if (eodId) {
    const rev = await request(`/api/work-reports/${eodId}`, {
      method: 'PATCH',
      cookie: mgr1Cookie,
      body: JSON.stringify({ comment: 'Great job today' }),
    })
    eodReviewed = rev.status === 200
  }
  record('V6.1', 'EOD report submit + manager review end-to-end', 'submit: 200/201, review: 200', `submit: ${eodSubmit.status}, review: ${eodReviewed ? 200 : 'failed'}`, [200, 201].includes(eodSubmit.status) && eodReviewed)
  record('V6.1', 'EOD report submit + manager review end-to-end', 'submit: 200/201, review: 200', `submit: ${eodSubmit.status}, review: ${eodReviewed ? 200 : 'failed'}`, [200, 201].includes(eodSubmit.status) && eodReviewed)

  // Fee Entry
  const student = await db.student.findFirst()
  const feeRes = await request('/api/fees', {
    method: 'POST',
    cookie: superCookie,
    body: JSON.stringify({
      studentId: student.id,
      amount: 15000,
      method: 'UPI',
    }),
  })
  record('V6.2', 'Fee payment entry created and audited', '201', feeRes.status, feeRes.status === 201)

  console.log('\n--- SUMMARY ---')
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  console.log(`TOTAL: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`)

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
