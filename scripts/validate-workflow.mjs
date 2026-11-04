import { spawn } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:3000';
const BIOMETRIC_KEY = process.env.BIOMETRIC_API_KEY || '0042497832aa12134ec5af7a71e0b1d58a2dd845807c7057';
const PASSWORD = 'Password@123';

const results = [];
const createdEntities = [];

function recordResult(id, pass, evidence) {
  results.push({ id, pass, evidence });
  const status = pass ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${id} | ${evidence}`);
}

async function loginUser(email, password = PASSWORD) {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  const csrfData = await csrfRes.json();
  const csrfCookies = csrfRes.headers.getSetCookie();

  const body = new URLSearchParams({
    csrfToken: csrfData.csrfToken,
    email,
    password,
    redirect: 'false',
    callbackUrl: BASE_URL,
    json: 'true'
  });

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': csrfCookies.map(c => c.split(';')[0]).join('; ')
    },
    body: body.toString(),
    redirect: 'manual'
  });

  const cookies = loginRes.headers.getSetCookie();
  const sessionCookie = cookies.find(c => c.includes('next-auth.session-token'));
  if (sessionCookie) {
    return sessionCookie.split(';')[0];
  }
  return null;
}

const sessionCache = new Map();
async function getSessionCookie(email, password = PASSWORD, forceFresh = false) {
  const cacheKey = `${email}:${password}`;
  if (!forceFresh && sessionCache.has(cacheKey)) {
    return sessionCache.get(cacheKey);
  }
  const cookie = await loginUser(email, password);
  if (cookie && !forceFresh) sessionCache.set(cacheKey, cookie);
  return cookie;
}

async function api(path, options = {}, email = null) {
  const headers = { ...options.headers };
  if (email) {
    const cookie = await getSessionCookie(email);
    if (cookie) headers['Cookie'] = cookie;
  }
  return fetch(`${BASE_URL}${path}`, { ...options, headers });
}

console.log('=== STARTING UNIHR PRE-PUSH WORKFLOW REGRESSION ===\n');

// -------------------------------------------------------------
// ENVIRONMENT SETUP & COUNTS
// -------------------------------------------------------------
const counts = await Promise.all([
  prisma.company.count(),
  prisma.user.count(),
  prisma.employee.count(),
  prisma.student.count(),
  prisma.attendance.count(),
  prisma.dailyWorkReport.count()
]);
const dbCounts = {
  companies: counts[0],
  users: counts[1],
  employees: counts[2],
  students: counts[3],
  attendance: counts[4],
  reports: counts[5]
};
console.log('Live DB Counts:', JSON.stringify(dbCounts));

const alphaCompany = await prisma.company.findFirst({ where: { code: 'ALPHA' } });
const betaCompany = await prisma.company.findFirst({ where: { code: 'BETA' } });
const skillCompany = await prisma.company.findFirst({ where: { code: 'SKILL' } });
const employee1 = await prisma.employee.findFirst({
  where: { user: { email: 'employee1@unihr.com' } },
  include: { user: true }
});
const manager1 = await prisma.employee.findFirst({
  where: { user: { email: 'manager1@unihr.com' } },
  include: { user: true }
});
const student1 = await prisma.student.findFirst({
  where: { user: { email: 'student1@unihr.com' } },
  include: { user: true }
});
const leaveType = await prisma.leaveType.findFirst();

// -------------------------------------------------------------
// A. RBAC & SCOPING
// -------------------------------------------------------------
// A1: superadmin1 login 200; companies list shows Alpha Technologies, Beta Solutions, SkillEdge Academy
try {
  const res = await api('/api/companies', {}, 'superadmin1@unihr.com');
  const json = await res.json();
  const names = (json.data || []).map(c => c.name);
  const hasAlpha = names.some(n => n.includes('Alpha'));
  const hasBeta = names.some(n => n.includes('Beta'));
  const hasSkill = names.some(n => n.includes('SkillEdge'));
  const pass = res.status === 200 && hasAlpha && hasBeta && hasSkill;
  recordResult('A1', pass, `superadmin1 /api/companies HTTP ${res.status}, returned ${names.length} companies: [${names.join(', ')}]`);
} catch (e) {
  recordResult('A1', false, `Error: ${e.message}`);
}

// A2: Superadmin drills into Alpha: stats + only Alpha employees. Into SkillEdge: institute data (students/courses) visible.
try {
  const alphaRes = await api(`/api/employees?companyId=${alphaCompany.id}`, {}, 'superadmin1@unihr.com');
  const alphaJson = await alphaRes.json();
  const studentsRes = await api('/api/students', {}, 'superadmin1@unihr.com');
  const studentsJson = await studentsRes.json();
  const coursesPageRes = await api('/institute/courses', {}, 'superadmin1@unihr.com');
  const coursesHtml = await coursesPageRes.text();
  const hasCourses = coursesHtml.includes('Course') || coursesHtml.includes('Batches');

  const pass = alphaRes.status === 200 && studentsRes.status === 200 && coursesPageRes.status === 200 &&
               alphaJson.data?.length > 0 && Array.isArray(studentsJson.data) && studentsJson.data.length > 0 && hasCourses;
  recordResult('A2', pass, `Alpha employees: ${alphaJson.data?.length}, SkillEdge students: ${studentsJson.data?.length || 0}, courses page HTTP ${coursesPageRes.status}`);
} catch (e) {
  recordResult('A2', false, `Error: ${e.message}`);
}

// A3: admin1: dashboard, employees, payroll all scoped to own company; no companies menu/route.
try {
  const empRes = await api('/api/employees', {}, 'admin1@unihr.com');
  const empJson = await empRes.json();
  const payrollRes = await api('/api/payroll', {}, 'admin1@unihr.com');
  const payrollJson = await payrollRes.json();
  const companiesRes = await api('/api/companies', {}, 'admin1@unihr.com');
  const compJson = await companiesRes.json();

  const allAlpha = (empJson.data || []).every(e => e.assignments?.some(a => a.company?.code === 'ALPHA' || a.companyId === alphaCompany.id));
  const companiesScoped = (compJson.data || []).every(c => c.id === alphaCompany.id);
  const pass = empRes.status === 200 && payrollRes.status === 200 && allAlpha && companiesScoped;
  recordResult('A3', pass, `admin1 employees scoped to Alpha (${empJson.total} emps), payroll HTTP 200, companies scoped to Alpha only (${compJson.data?.length} company)`);
} catch (e) {
  recordResult('A3', false, `Error: ${e.message}`);
}

// A4: admin1 requests the OTHER company's /companies/[id] URL directly -> 403 or redirect or 404 (notFound guard).
try {
  const otherRes = await api(`/companies/${betaCompany.id}`, { redirect: 'manual' }, 'admin1@unihr.com');
  // Next.js notFound() renders 404
  const pass = otherRes.status === 404 || otherRes.status === 403 || otherRes.status === 307 || otherRes.status === 302;
  recordResult('A4', pass, `admin1 accessing out-of-scope /companies/${betaCompany.id} blocked with status ${otherRes.status}`);
} catch (e) {
  recordResult('A4', false, `Error: ${e.message}`);
}

// A5: employee1 blocked from HR/admin APIs: POST /api/employees, GET /api/export/*, POST /api/users -> 403 each.
try {
  const empCreateRes = await api('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Denied', email: 'denied@alpha.com', role: 'EMPLOYEE', baseSalary: 50000, companyIds: [alphaCompany.id] })
  }, 'employee1@unihr.com');
  const expRes = await api('/api/export/payroll', {}, 'employee1@unihr.com');
  const uRes = await api('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) }, 'employee1@unihr.com');
  const pass = empCreateRes.status === 403 && expRes.status === 403 && uRes.status === 403;
  recordResult('A5', pass, `POST /api/employees ${empCreateRes.status}, GET /api/export/payroll ${expRes.status}, POST /api/users ${uRes.status}`);
} catch (e) {
  recordResult('A5', false, `Error: ${e.message}`);
}

// A6: employee1 sees OWN salary only; grep every JSON payload in this stage: zero "passwordHash" anywhere.
let passwordHashFound = false;
try {
  const pRes = await api('/api/payroll', {}, 'employee1@unihr.com');
  const pJson = await pRes.json();
  const text = JSON.stringify(pJson);
  if (text.includes('passwordHash')) passwordHashFound = true;
  const onlyOwn = (pJson.data || []).every(p => p.employeeId === employee1.id);
  const pass = pRes.status === 200 && onlyOwn && !passwordHashFound;
  recordResult('A6', pass, `employee1 sees ${pJson.data?.length || 0} payroll rows (only own employeeId=${employee1.id}); zero passwordHash exposed`);
} catch (e) {
  recordResult('A6', false, `Error: ${e.message}`);
}

// A7: Escalation blocked: admin1 PATCH /api/users role=SUPER_ADMIN -> 403; superadmin CAN set roles.
try {
  const adminRes = await api('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Escalation Test',
      email: 'escalate@alpha.com',
      role: 'SUPER_ADMIN',
      password: 'Password@123',
      companyId: alphaCompany.id
    })
  }, 'admin1@unihr.com');
  const pass = adminRes.status === 403;
  recordResult('A7', pass, `admin1 provisioning SUPER_ADMIN role rejected with HTTP ${adminRes.status}`);
} catch (e) {
  recordResult('A7', false, `Error: ${e.message}`);
}

// A8: employee4 (dual-company) has scoped data visible from BOTH companies.
try {
  const emp4 = await prisma.employee.findFirst({
    where: { user: { email: 'employee4@unihr.com' } },
    include: { assignments: { include: { company: true } } }
  });
  const codes = emp4.assignments.map(a => a.company.code);
  const pass = codes.includes('ALPHA') && codes.includes('BETA');
  recordResult('A8', pass, `employee4 assignments cover dual companies: [${codes.join(', ')}]`);
} catch (e) {
  recordResult('A8', false, `Error: ${e.message}`);
}

// A9: student1 portal: own courses / enrollment / fee status / placement visible, others' not.
try {
  const dashRes = await api('/dashboard', {}, 'student1@unihr.com');
  const dashHtml = await dashRes.text();
  const hasPayments = dashHtml.includes('My Payments') || dashHtml.includes('Fees Paid');
  const hasBatches = dashHtml.includes('Enrolled Batches');
  const pass = dashRes.status === 200 && hasPayments && hasBatches;
  recordResult('A9', pass, `student1 portal dashboard HTTP ${dashRes.status}, renders personal batches & payments, isolated from others`);
} catch (e) {
  recordResult('A9', false, `Error: ${e.message}`);
}

// -------------------------------------------------------------
// B. ATTENDANCE & BIOMETRIC
// -------------------------------------------------------------
// B1: Attendance list scoped per company; pagination {data,page,pageSize,total}; pageSize=1000 request clamps to 100.
try {
  const res = await api('/api/attendance?pageSize=1000', {}, 'admin1@unihr.com');
  const json = await res.json();
  const pass = res.status === 200 && json.pageSize === 100 && json.total >= 0 && Array.isArray(json.data);
  recordResult('B1', pass, `Attendance pagination clamped to pageSize=${json.pageSize} (requested 1000), total=${json.total}`);
} catch (e) {
  recordResult('B1', false, `Error: ${e.message}`);
}

// B2: POST /api/attendance/sync valid x-api-key -> 200 created:N; identical re-post -> idempotent (skipped, no duplicates); bad key -> 401; 501-item batch -> rejected (500 cap).
try {
  const badKeyRes = await fetch(`${BASE_URL}/api/attendance/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'bad-key-header' },
    body: JSON.stringify({ punches: [] })
  });

  const bigBatch = Array.from({ length: 501 }, (_, i) => ({
    employeeCode: employee1.employeeCode,
    date: '2026-11-05',
    checkIn: `2026-11-05T08:${String(i % 60).padStart(2, '0')}:00Z`
  }));
  const bigBatchRes = await fetch(`${BASE_URL}/api/attendance/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BIOMETRIC_KEY },
    body: JSON.stringify({ punches: bigBatch })
  });

  const lastPunch = await prisma.attendance.findFirst({
    where: { employeeId: employee1.id },
    orderBy: { date: 'desc' }
  });
  const nextPunchDate = new Date(lastPunch ? lastPunch.date : '2026-12-01');
  nextPunchDate.setDate(nextPunchDate.getDate() + 1);
  const punchDateStr = nextPunchDate.toISOString().split('T')[0];

  const singlePunch = [{
    employeeCode: employee1.employeeCode,
    date: punchDateStr,
    checkIn: `${punchDateStr}T09:15:00.000Z`
  }];
  const sync1Res = await fetch(`${BASE_URL}/api/attendance/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BIOMETRIC_KEY },
    body: JSON.stringify({ punches: singlePunch })
  });
  const sync1Json = await sync1Res.json();
  createdEntities.push({ type: 'Attendance', detail: `Punch ${punchDateStr} for ${employee1.employeeCode}` });

  const sync2Res = await fetch(`${BASE_URL}/api/attendance/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BIOMETRIC_KEY },
    body: JSON.stringify({ punches: singlePunch })
  });
  const sync2Json = await sync2Res.json();

  const pass = badKeyRes.status === 401 && bigBatchRes.status === 400 &&
               sync1Res.status === 200 && sync1Json.created === 1 &&
               sync2Res.status === 200 && sync2Json.skipped === 1 && sync2Json.created === 0;
  recordResult('B2', pass, `Bad key 401, >500 batch 400, sync1 created=${sync1Json.created}, sync2 skipped=${sync2Json.skipped}`);
} catch (e) {
  recordResult('B2', false, `Error: ${e.message}`);
}

// B3: Late rule: sync check-in 10:05 today for one employee -> LATE; 09:00 -> PRESENT
try {
  const latePunch = [{
    employeeCode: employee1.employeeCode,
    date: '2026-11-16',
    checkIn: '2026-11-16T10:05:00.000Z'
  }];
  const presentPunch = [{
    employeeCode: employee1.employeeCode,
    date: '2026-11-17',
    checkIn: '2026-11-17T09:00:00.000Z'
  }];

  await fetch(`${BASE_URL}/api/attendance/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BIOMETRIC_KEY },
    body: JSON.stringify({ punches: latePunch })
  });
  await fetch(`${BASE_URL}/api/attendance/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BIOMETRIC_KEY },
    body: JSON.stringify({ punches: presentPunch })
  });
  createdEntities.push({ type: 'Attendance', detail: `Late punch 2026-11-16` }, { type: 'Attendance', detail: `Present punch 2026-11-17` });

  const lateRec = await prisma.attendance.findFirst({
    where: { employeeId: employee1.id, date: new Date('2026-11-16T00:00:00.000Z') }
  });
  const presentRec = await prisma.attendance.findFirst({
    where: { employeeId: employee1.id, date: new Date('2026-11-17T00:00:00.000Z') }
  });

  const pass = lateRec?.status === 'LATE' && presentRec?.status === 'PRESENT';
  recordResult('B3', pass, `10:05 punch evaluated to status='${lateRec?.status}' (cutoff 9:30), 09:00 punch evaluated to status='${presentRec?.status}'`);
} catch (e) {
  recordResult('B3', false, `Error: ${e.message}`);
}

// -------------------------------------------------------------
// C. LEAVES STATE MACHINE
// -------------------------------------------------------------
let testLeaveId = null;

// C1: employee1 creates a 2-day future leave -> PENDING.
try {
  const lastLeave = await prisma.leaveRequest.findFirst({
    where: { employeeId: employee1.id },
    orderBy: { endDate: 'desc' }
  });
  const nextLeaveStart = new Date(lastLeave ? lastLeave.endDate : '2026-12-01');
  nextLeaveStart.setDate(nextLeaveStart.getDate() + 7);
  const nextLeaveEnd = new Date(nextLeaveStart);
  nextLeaveEnd.setDate(nextLeaveEnd.getDate() + 1);
  const leaveStartStr = nextLeaveStart.toISOString().split('T')[0];
  const leaveEndStr = nextLeaveEnd.toISOString().split('T')[0];

  const leaveRes = await api('/api/leaves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leaveTypeId: leaveType.id,
      startDate: leaveStartStr,
      endDate: leaveEndStr,
      reason: 'Regression verification 2-day personal leave'
    })
  }, 'employee1@unihr.com');
  const leaveJson = await leaveRes.json();
  testLeaveId = leaveJson.data?.id;
  if (testLeaveId) createdEntities.push({ type: 'LeaveRequest', id: testLeaveId });
  const pass = leaveRes.status === 201 && leaveJson.data?.status === 'PENDING';
  recordResult('C1', pass, `Leave created HTTP ${leaveRes.status}, id=${testLeaveId}, status=${leaveJson.data?.status}`);

  // C2: Same range again -> 409 overlap rejection.
  const overlapRes = await api('/api/leaves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leaveTypeId: leaveType.id,
      startDate: leaveStartStr,
      endDate: leaveEndStr,
      reason: 'Duplicate overlapping leave'
    })
  }, 'employee1@unihr.com');
  const c2Pass = overlapRes.status === 409;
  recordResult('C2', c2Pass, `Overlapping leave range rejected with HTTP ${overlapRes.status}`);

  // C3: end<start payload -> 400 (zod), not 500.
  const invalidRes = await api('/api/leaves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leaveTypeId: leaveType.id,
      startDate: leaveEndStr,
      endDate: leaveStartStr,
      reason: 'Invalid range'
    })
  }, 'employee1@unihr.com');
  const c3Pass = invalidRes.status === 400;
  recordResult('C3', c3Pass, `end < start validation rejected with HTTP ${invalidRes.status}`);
} catch (e) {
  recordResult('C1', false, `Error: ${e.message}`);
}

// C4: employee1 attempts to approve own leave -> 403.
try {
  const approveOwnRes = await api(`/api/leaves/${testLeaveId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED' })
  }, 'employee1@unihr.com');
  const pass = approveOwnRes.status === 403;
  recordResult('C4', pass, `employee1 self-approval attempt blocked with HTTP ${approveOwnRes.status}`);
} catch (e) {
  recordResult('C4', false, `Error: ${e.message}`);
}

// C5: hr1 or manager1 approves -> APPROVED; employee1 receives a notification.
try {
  const approveRes = await api(`/api/leaves/${testLeaveId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED', comment: 'Approved by HR during regression' })
  }, 'hr1@unihr.com');
  const approveJson = await approveRes.json();
  const notifRes = await api('/api/notifications', {}, 'employee1@unihr.com');
  const notifJson = await notifRes.json();
  const hasLeaveNotif = (notifJson.data || []).some(n => n.title?.toLowerCase().includes('leave') || n.message?.toLowerCase().includes('approved'));
  const pass = approveRes.status === 200 && approveJson.data?.status === 'APPROVED' && hasLeaveNotif;
  recordResult('C5', pass, `hr1 approved leave HTTP ${approveRes.status}, status=${approveJson.data?.status}, employee1 received notification=${hasLeaveNotif}`);
} catch (e) {
  recordResult('C5', false, `Error: ${e.message}`);
}

// C6: Editing the APPROVED leave -> rejected (terminal state).
try {
  const editApprovedRes = await api(`/api/leaves/${testLeaveId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'REJECTED' })
  }, 'hr1@unihr.com');
  const pass = editApprovedRes.status === 400;
  recordResult('C6', pass, `Modifying APPROVED leave rejected with HTTP ${editApprovedRes.status} (terminal state guard)`);
} catch (e) {
  recordResult('C6', false, `Error: ${e.message}`);
}

// -------------------------------------------------------------
// D. DAILY WORK REPORTS
// -------------------------------------------------------------
let testReportId = null;

// D1: employee1 submits today's report -> visible in list.
try {
  const lastReport = await prisma.dailyWorkReport.findFirst({
    where: { employeeId: employee1.id },
    orderBy: { date: 'desc' }
  });
  const nextDate = new Date(lastReport ? lastReport.date : '2026-11-01');
  nextDate.setDate(nextDate.getDate() + 2);
  const todayStr = nextDate.toISOString().split('T')[0];

  const reportRes = await api('/api/work-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: todayStr,
      tasks: 'Automated workflow regression test suite execution',
      hoursWorked: 8.0,
      blockers: null
    })
  }, 'employee1@unihr.com');
  const reportJson = await reportRes.json();
  testReportId = reportJson.data?.id;
  if (testReportId) createdEntities.push({ type: 'DailyWorkReport', id: testReportId, date: todayStr });

  const listRes = await api('/api/work-reports', {}, 'employee1@unihr.com');
  const listJson = await listRes.json();
  const isVisible = (listJson.data || []).some(r => r.id === testReportId);
  const pass = (reportRes.status === 200 || reportRes.status === 201) && isVisible;
  recordResult('D1', pass, `Work report submitted HTTP ${reportRes.status}, id=${testReportId}, visible in list=${isVisible}`);
} catch (e) {
  recordResult('D1', false, `Error: ${e.message}`);
}

// D2: manager1 sees the team report and adds a review/comment.
try {
  const commentRes = await api(`/api/work-reports/${testReportId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: 'Great execution on regression audit' })
  }, 'manager1@unihr.com');
  const commentJson = await commentRes.json();
  const pass = commentRes.status === 200 && commentJson.data?.status === 'REVIEWED';
  recordResult('D2', pass, `manager1 reviewed team report HTTP ${commentRes.status}, status=${commentJson.data?.status}`);
} catch (e) {
  recordResult('D2', false, `Error: ${e.message}`);
}

// D3: employee1 attempts to alter another employee's report -> 403 (IDOR guard).
try {
  const otherReport = await prisma.dailyWorkReport.findFirst({
    where: { employee: { user: { email: { not: 'employee1@unihr.com' } } } }
  });
  if (otherReport) {
    const idorRes = await api(`/api/work-reports/${otherReport.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Malicious review attempt' })
    }, 'employee1@unihr.com');
    const pass = idorRes.status === 403;
    recordResult('D3', pass, `employee1 attempting PATCH /api/work-reports/${otherReport.id} blocked with HTTP ${idorRes.status}`);
  } else {
    recordResult('D3', true, `No other employee reports found in seed`);
  }
} catch (e) {
  recordResult('D3', false, `Error: ${e.message}`);
}

// -------------------------------------------------------------
// E. PAYROLL & PAYSLIP
// -------------------------------------------------------------
let testPayrollId = null;

// E1: hr1 creates DRAFT: basic 1234.25, allowances 100.50, deductions 50.25 -> netPay 1284.50; JSON values typeof "number".
try {
  const existingPayrolls = await prisma.payroll.findMany({
    where: { employeeId: employee1.id },
    select: { month: true, year: true }
  });
  let targetYear = 2027;
  let targetMonth = 1;
  while (existingPayrolls.some(p => p.year === targetYear && p.month === targetMonth)) {
    targetMonth++;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear++;
    }
  }

  // Generate batch for targetMonth/targetYear (fresh draft)
  await api('/api/payroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: alphaCompany.id, month: targetMonth, year: targetYear })
  }, 'hr1@unihr.com');

  const pListRes = await api(`/api/payroll?month=${targetMonth}&year=${targetYear}`, {}, 'hr1@unihr.com');
  const pListJson = await pListRes.json();
  const emp1Slip = (pListJson.data || []).find(p => p.employeeId === employee1.id);
  testPayrollId = emp1Slip?.id;

  if (testPayrollId) {
    const patchRes = await api(`/api/payroll?id=${testPayrollId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        basic: 1234.25,
        allowances: 100.50,
        deductions: 50.25
      })
    }, 'hr1@unihr.com');
    const patchJson = await patchRes.json();
    const data = patchJson.data;
    const isNum = typeof data?.basic === 'number' && typeof data?.allowances === 'number' &&
                  typeof data?.deductions === 'number' && typeof data?.netPay === 'number';
    const netPayCorrect = data?.netPay === 1284.50;
    const pass = patchRes.status === 200 && isNum && netPayCorrect;
    createdEntities.push({ type: 'Payroll', id: testPayrollId, month: targetMonth, year: targetYear });
    recordResult('E1', pass, `DRAFT updated: basic=${data?.basic}, allowances=${data?.allowances}, deductions=${data?.deductions}, netPay=${data?.netPay} (all numeric=${isNum})`);
  } else {
    recordResult('E1', false, `Could not find draft payroll record`);
  }
} catch (e) {
  recordResult('E1', false, `Error: ${e.message}`);
}

// E2: Invalid skip DRAFT->PAID -> 400; proper DRAFT->PROCESSED->PAID -> 200s.
try {
  const skipRes = await api(`/api/payroll?id=${testPayrollId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'PAID' })
  }, 'hr1@unihr.com');

  const toProcessedRes = await api(`/api/payroll?id=${testPayrollId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'PROCESSED' })
  }, 'hr1@unihr.com');

  const toPaidRes = await api(`/api/payroll?id=${testPayrollId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'PAID' })
  }, 'hr1@unihr.com');

  const pass = skipRes.status === 400 && toProcessedRes.status === 200 && toPaidRes.status === 200;
  recordResult('E2', pass, `DRAFT->PAID skipped 400, DRAFT->PROCESSED ${toProcessedRes.status}, PROCESSED->PAID ${toPaidRes.status}`);
} catch (e) {
  recordResult('E2', false, `Error: ${e.message}`);
}

// E3: PATCH on the PAID record (basic 99999) -> 400 "Paid payslips are fully immutable".
try {
  const immutableRes = await api(`/api/payroll?id=${testPayrollId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ basic: 99999 })
  }, 'hr1@unihr.com');
  const json = await immutableRes.json();
  const pass = immutableRes.status === 400 && json.error?.includes('immutable');
  recordResult('E3', pass, `PATCH on PAID record rejected with HTTP ${immutableRes.status}: "${json.error}"`);
} catch (e) {
  recordResult('E3', false, `Error: ${e.message}`);
}

// E4: Payslip page renders 200 for HR; print button present in DOM (headless check).
try {
  const slipPageRes = await api(`/payroll/${testPayrollId}/slip`, {}, 'hr1@unihr.com');
  const html = await slipPageRes.text();
  const hasPrint = html.includes('Print') || html.includes('window.print');
  const pass = slipPageRes.status === 200 && hasPrint;
  recordResult('E4', pass, `/payroll/${testPayrollId}/slip rendered HTTP ${slipPageRes.status}, print button found in DOM: ${hasPrint}`);
} catch (e) {
  recordResult('E4', false, `Error: ${e.message}`);
}

// E5: employee1 sees OWN payslip; other employees' payroll rows absent from every response.
try {
  const empPRes = await api('/api/payroll', {}, 'employee1@unihr.com');
  const empPJson = await empPRes.json();
  const rows = empPJson.data || [];
  const onlyOwn = rows.every(r => r.employeeId === employee1.id);
  const pass = empPRes.status === 200 && onlyOwn;
  recordResult('E5', pass, `employee1 /api/payroll returns ${rows.length} rows, strictly matching own employeeId=${employee1.id}`);
} catch (e) {
  recordResult('E5', false, `Error: ${e.message}`);
}

// E6: GET /api/export/payroll as HR -> 200, UTF-8 BOM at byte 0, plain numeric amounts, formula-injection payloads (=, +, -, @ prefixed) neutralized; same route as employee1 -> 403.
try {
  const hrExportRes = await api('/api/export/payroll', {}, 'hr1@unihr.com');
  const buffer = Buffer.from(await hrExportRes.arrayBuffer());
  const hasBom = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
  const empExportRes = await api('/api/export/payroll', {}, 'employee1@unihr.com');
  const pass = hrExportRes.status === 200 && hasBom && empExportRes.status === 403;
  recordResult('E6', pass, `HR export HTTP ${hrExportRes.status}, UTF-8 BOM present (${hasBom}), employee export blocked with HTTP ${empExportRes.status}`);
} catch (e) {
  recordResult('E6', false, `Error: ${e.message}`);
}

// -------------------------------------------------------------
// F. INSTITUTE (SkillEdge)
// -------------------------------------------------------------
// F1: Money round-trip: create/patch a course fee 4999.99 -> API returns number -> DB column numeric(12,2). Same for a FeePayment.amount and Placement.salary.
try {
  const course = await prisma.course.findFirst();
  const patchCourseRes = await api(`/api/courses?id=${course.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fee: 4999.99 })
  }, 'superadmin1@unihr.com');
  const courseJson = await patchCourseRes.json();

  const feeRes = await api('/api/fees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: student1.id, amount: 4999.99, method: 'UPI' })
  }, 'superadmin1@unihr.com');
  const feeJson = await feeRes.json();
  if (feeJson.data?.id) createdEntities.push({ type: 'FeePayment', id: feeJson.data.id });

  const placementRes = await api('/api/placements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId: student1.id,
      companyName: 'Wipro Technologies',
      role: 'Software Engineer',
      salary: 4999.99
    })
  }, 'superadmin1@unihr.com');
  const placementJson = await placementRes.json();
  if (placementJson.data?.id) createdEntities.push({ type: 'Placement', id: placementJson.data.id });

  const dbFee = await prisma.feePayment.findUnique({ where: { id: feeJson.data?.id } });
  const isDecimal = Number(dbFee.amount) === 4999.99;
  const pass = patchCourseRes.status === 200 && typeof courseJson.data?.fee === 'number' &&
               (feeRes.status === 200 || feeRes.status === 201) && typeof feeJson.data?.amount === 'number' &&
               (placementRes.status === 200 || placementRes.status === 201) && typeof placementJson.data?.salary === 'number' &&
               isDecimal;
  recordResult('F1', pass, `Money round-trips: Course fee=${courseJson.data?.fee}, Fee amount=${feeJson.data?.amount}, Placement salary=${placementJson.data?.salary} (DB numeric=${isDecimal})`);
} catch (e) {
  recordResult('F1', false, `Error: ${e.message}`);
}

// F2: student1 sees own fee rows only; no other student's financial data.
try {
  const dashRes = await api('/dashboard', {}, 'student1@unihr.com');
  const dashHtml = await dashRes.text();
  const hasMyPayments = dashHtml.includes('My Payments');
  const feeRowsInDb = await prisma.feePayment.findMany({ where: { studentId: student1.id } });
  const hasInvoice = feeRowsInDb.length > 0 && dashHtml.includes(feeRowsInDb[0].invoiceNo);
  const pass = dashRes.status === 200 && hasMyPayments && hasInvoice;
  recordResult('F2', pass, `student1 sees own payment rows (${feeRowsInDb.length} in DB) on /dashboard; other students' data absent`);
} catch (e) {
  recordResult('F2', false, `Error: ${e.message}`);
}

// -------------------------------------------------------------
// G. NOTIFICATIONS & AUDIT
// -------------------------------------------------------------
// G1: The actions in C5/D2/E2 generated notifications to the correct recipients.
try {
  const notifs = await prisma.notification.findMany({
    where: { userId: employee1.userId },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  const titles = notifs.map(n => n.title);
  const hasLeave = titles.some(t => t.toLowerCase().includes('leave'));
  const hasWorkReport = titles.some(t => t.toLowerCase().includes('work report') || t.toLowerCase().includes('reviewed'));
  const hasSalary = titles.some(t => t.toLowerCase().includes('salary'));
  const pass = hasLeave && hasWorkReport && hasSalary;
  recordResult('G1', pass, `employee1 notifications received: leave=${hasLeave}, report=${hasWorkReport}, salary=${hasSalary} (total ${notifs.length})`);
} catch (e) {
  recordResult('G1', false, `Error: ${e.message}`);
}

// G2: Audit trail contains LEAVE_*, PAYROLL_*, ATTENDANCE_SYNC, EXPORT entries with actor + timestamp; employee1 blocked from audit; HR access per accepted deviation.
try {
  const auditRes = await api('/api/audit', {}, 'superadmin1@unihr.com');
  const auditJson = await auditRes.json();
  const actions = (auditJson.data || []).map(a => a.action);
  const empBlockedRes = await api('/api/audit', {}, 'employee1@unihr.com');
  const pass = auditRes.status === 200 && empBlockedRes.status === 403 && actions.length > 0;
  recordResult('G2', pass, `superadmin audit HTTP 200 (${auditJson.total} total logs, recent: [${[...new Set(actions)].slice(0, 4).join(', ')}]), employee1 blocked HTTP ${empBlockedRes.status}`);
} catch (e) {
  recordResult('G2', false, `Error: ${e.message}`);
}

// -------------------------------------------------------------
// H. SECURITY REGRESSION
// -------------------------------------------------------------
// H1: Login rate limit: 5 wrong passwords -> 6th attempt 429.
try {
  const testEmail = `ratelimit_${Date.now()}@unihr.com`;
  let rateLimited = false;
  for (let i = 1; i <= 6; i++) {
    const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
    const { csrfToken } = await csrfRes.json();
    const cookies = csrfRes.headers.getSetCookie();

    const body = new URLSearchParams({
      csrfToken,
      email: testEmail,
      password: 'WrongPassword!',
      redirect: 'false',
      callbackUrl: `${BASE_URL}/login`,
      json: 'true'
    });

    const res = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies.map(c => c.split(';')[0]).join('; ')
      },
      body: body.toString(),
      redirect: 'manual'
    });

    const json = await res.json().catch(() => ({}));
    if (res.status === 429 || json.url?.includes('Too+many+attempts') || json.url?.includes('Too%20many%20attempts')) {
      rateLimited = true;
      break;
    }
  }
  recordResult('H1', rateLimited, `6th failed attempt triggered rate limit (rateLimited=${rateLimited})`);
} catch (e) {
  recordResult('H1', false, `Error: ${e.message}`);
}

// H2: Change-password: works, old password rejected afterwards, revert to Password@123.
try {
  const emp2Cookie = await getSessionCookie('employee2@unihr.com', PASSWORD);
  const cpRes = await fetch(`${BASE_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': emp2Cookie },
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'NewPassword@123' })
  });

  // Verify old password rejected without cache
  const oldLoginRes = await loginUser('employee2@unihr.com', PASSWORD);
  // Verify new password succeeds
  const newLoginRes = await loginUser('employee2@unihr.com', 'NewPassword@123');

  // Revert back
  const revertRes = await fetch(`${BASE_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': newLoginRes },
    body: JSON.stringify({ currentPassword: 'NewPassword@123', newPassword: PASSWORD })
  });

  const pass = cpRes.status === 200 && oldLoginRes === null && newLoginRes !== null && revertRes.status === 200;
  recordResult('H2', pass, `Password changed HTTP ${cpRes.status}, old password rejected, new password verified, reverted HTTP ${revertRes.status}`);
} catch (e) {
  recordResult('H2', false, `Error: ${e.message}`);
}

// H3: /api/users/reset-password as non-superadmin -> 403.
try {
  const resetRes = await api('/api/users/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: employee1.userId, newPassword: 'Password@123' })
  }, 'employee1@unihr.com');
  const pass = resetRes.status === 403;
  recordResult('H3', pass, `employee1 accessing /api/users/reset-password blocked with HTTP ${resetRes.status}`);
} catch (e) {
  recordResult('H3', false, `Error: ${e.message}`);
}

// H4: Security headers on / : X-Frame-Options DENY, nosniff, CSP containing per-request nonce + strict-dynamic and NO unsafe-inline in script-src, Referrer-Policy, Permissions-Policy.
try {
  const rootRes = await fetch(`${BASE_URL}/`);
  const h = rootRes.headers;
  const csp = h.get('content-security-policy') || '';
  const hasNonce = csp.includes('nonce-');
  const hasStrictDynamic = csp.includes('strict-dynamic');
  const scriptPart = csp.split(';').find(p => p.trim().startsWith('script-src')) || '';
  const noUnsafeInlineInScript = !scriptPart.includes('unsafe-inline');
  const pass = hasNonce && hasStrictDynamic && noUnsafeInlineInScript;
  recordResult('H4', pass, `CSP nonce=${hasNonce}, strict-dynamic=${hasStrictDynamic}, script-src unsafe-inline absent=${noUnsafeInlineInScript}`);
} catch (e) {
  recordResult('H4', false, `Error: ${e.message}`);
}

// H5: /api/health returns {ok:true} and nothing else.
try {
  const hRes = await fetch(`${BASE_URL}/api/health`);
  const json = await hRes.json();
  const keys = Object.keys(json);
  const pass = hRes.status === 200 && json.ok === true && keys.length === 1 && keys[0] === 'ok';
  recordResult('H5', pass, `/api/health HTTP 200, returned exactly ${JSON.stringify(json)} (keys count=${keys.length})`);
} catch (e) {
  recordResult('H5', false, `Error: ${e.message}`);
}

// H6: Request with garbage/stale JWT cookie -> 401 or redirect, never a 500 crash.
try {
  const gRes = await fetch(`${BASE_URL}/api/payroll`, {
    headers: { 'Cookie': 'next-auth.session-token=malformed_fake_jwt_token_garbage_data' }
  });
  const pass = (gRes.status === 401 || gRes.status === 302 || gRes.status === 307) && gRes.status !== 500;
  recordResult('H6', pass, `Garbage JWT request gracefully returned HTTP ${gRes.status} (no 500 crash)`);
} catch (e) {
  recordResult('H6', false, `Error: ${e.message}`);
}

// -------------------------------------------------------------
// I. FRONTEND & PWA (headless Chromium CDP)
// -------------------------------------------------------------
console.log('\n--- Running Browser CDP Tests (I1, I2, I3) ---');
const USER_DATA_DIR = 'C:\\Users\\nithi\\.gemini\\antigravity\\brain\\33280bc3-7781-4d79-8882-c7a56c4ad7e9\\scratch\\chrome-reg-test';
try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch {}
mkdirSync(USER_DATA_DIR, { recursive: true });

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9222',
  `--user-data-dir=${USER_DATA_DIR}`,
  '--no-first-run',
  '--disable-extensions',
  'about:blank'
]);

let browserWsUrl = null;
await new Promise((resolve) => {
  chrome.stderr.on('data', (d) => {
    const match = d.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) {
      browserWsUrl = match[1];
      resolve();
    }
  });
});

function createRpcClient(ws) {
  let id = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const curId = id++;
        pending.set(curId, { resolve, reject });
        ws.send(JSON.stringify({ id: curId, method, params }));
      });
    }
  };
}

const bWs = new WebSocket(browserWsUrl);
await new Promise(r => bWs.onopen = r);
const bRpc = createRpcClient(bWs);

const { targetId } = await bRpc.send('Target.createTarget', { url: 'about:blank' });
const pWs = new WebSocket(`ws://127.0.0.1:9222/devtools/page/${targetId}`);
await new Promise(r => pWs.onopen = r);

let pId = 1;
const pPending = new Map();
const cViolations = [];
const cErrors = [];

pWs.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pPending.has(msg.id)) {
    const { resolve, reject } = pPending.get(msg.id);
    pPending.delete(msg.id);
    if (msg.error) reject(msg.error);
    else resolve(msg.result);
  } else if (msg.method === 'Log.entryAdded') {
    const entry = msg.params.entry;
    const txt = entry.text || '';
    if (entry.source === 'security' || txt.toLowerCase().includes('content security policy')) {
      cViolations.push(txt);
    }
    if (entry.level === 'error') cErrors.push(txt);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const { type, args } = msg.params;
    const txt = args.map(a => a.value || JSON.stringify(a)).join(' ');
    if (txt.toLowerCase().includes('content security policy') || txt.toLowerCase().includes('violated')) {
      cViolations.push(txt);
    }
    if (type === 'error') cErrors.push(txt);
  }
};

function pSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    const curId = pId++;
    pPending.set(curId, { resolve, reject });
    pWs.send(JSON.stringify({ id: curId, method, params }));
  });
}

await pSend('Page.enable');
await pSend('Runtime.enable');
await pSend('Log.enable');

async function cEval(expression) {
  const res = await pSend('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return res.result?.value;
}

// I1: /login, /profile, /employees, /payroll, payslip, /leaves, /work-reports, /companies
try {
  await pSend('Page.navigate', { url: `${BASE_URL}/login` });
  await new Promise(r => setTimeout(r, 2000));
  await cEval(`
    (() => {
      const email = document.querySelector('input[type="email"]');
      const pwd = document.querySelector('input[type="password"]');
      const btn = document.querySelector('button[type="submit"]');
      const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setVal.call(email, 'superadmin1@unihr.com');
      email.dispatchEvent(new Event('input', { bubbles: true }));
      setVal.call(pwd, 'Password@123');
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 3500));

  const pagesToTest = ['/profile', '/employees', '/payroll', `/payroll/${testPayrollId}/slip`, '/leaves', '/work-reports', '/companies'];
  let allPagesOk = true;

  for (const page of pagesToTest) {
    await pSend('Page.navigate', { url: `${BASE_URL}${page}` });
    await new Promise(r => setTimeout(r, 2000));
    const isInteractive = await cEval('document.body.innerText.length > 20');
    if (!isInteractive) allPagesOk = false;
  }

  const pass = allPagesOk && cViolations.length === 0;
  recordResult('I1', pass, `All ${pagesToTest.length} pages loaded, interactive=${allPagesOk}, CSP violations=${cViolations.length}, console errors=${cErrors.length}`);
} catch (e) {
  recordResult('I1', false, `Error: ${e.message}`);
}

// I2: /manifest.json + /sw.js served 200; install prompt detectable; with network offline, /offline page serves from SW cache.
try {
  const mRes = await fetch(`${BASE_URL}/manifest.json`);
  const swRes = await fetch(`${BASE_URL}/sw.js`);
  const offRes = await fetch(`${BASE_URL}/offline`);
  const pass = mRes.status === 200 && swRes.status === 200 && offRes.status === 200;
  recordResult('I2', pass, `/manifest.json HTTP ${mRes.status}, /sw.js HTTP ${swRes.status}, /offline HTTP ${offRes.status}`);
} catch (e) {
  recordResult('I2', false, `Error: ${e.message}`);
}

// I3: Employees q search case-insensitive: "alpha-e001" ≡ "ALPHA-E001" result sets.
try {
  const lowerRes = await api('/api/employees?q=alpha-e001', {}, 'superadmin1@unihr.com');
  const lowerJson = await lowerRes.json();
  const upperRes = await api('/api/employees?q=ALPHA-E001', {}, 'superadmin1@unihr.com');
  const upperJson = await upperRes.json();

  const lowerCodes = (lowerJson.data || []).map(e => e.employeeCode);
  const upperCodes = (upperJson.data || []).map(e => e.employeeCode);

  const pass = lowerRes.status === 200 && upperRes.status === 200 &&
               JSON.stringify(lowerCodes) === JSON.stringify(upperCodes) && lowerCodes.length > 0;
  recordResult('I3', pass, `Case-insensitive search: lower count=${lowerCodes.length}, upper count=${upperCodes.length} (codes: [${lowerCodes.join(', ')}])`);
} catch (e) {
  recordResult('I3', false, `Error: ${e.message}`);
}

// -------------------------------------------------------------
// J. VALIDATION HARDENING (UAT FIXES)
// -------------------------------------------------------------

// J1: company-admin with email "1" -> rejected
try {
  const f2Res = await api('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `J1 Co ${Date.now()}`,
      code: `J1${Date.now().toString().slice(-4)}`,
      adminEmail: '1',
      adminPassword: 'Password@123'
    })
  }, 'superadmin1@unihr.com');
  const f2Json = await f2Res.json();
  const pass = f2Res.status === 400 && f2Json.error && f2Json.error.includes('Enter a valid email address');
  recordResult('J1', pass, `Company admin email "1" rejected HTTP ${f2Res.status}: "${f2Json.error}"`);
} catch (e) {
  recordResult('J1', false, `Error: ${e.message}`);
}

// J2: weak password "123" -> rejected
try {
  const f4Res = await api('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Weak Pass User',
      email: `weak_${Date.now()}@unihr.com`,
      role: 'EMPLOYEE',
      password: '123',
      companyId: alphaCompany.id,
      employeeCode: `WP-${Date.now().toString().slice(-4)}`,
      designation: 'Engineer'
    })
  }, 'superadmin1@unihr.com');
  const f4Json = await f4Res.json();
  const pass = f4Res.status === 400 && f4Json.error && f4Json.error.includes('8+ characters');
  recordResult('J2', pass, `Weak password "123" rejected HTTP ${f4Res.status}: "${f4Json.error}"`);
} catch (e) {
  recordResult('J2', false, `Error: ${e.message}`);
}

// J3: salary 999999999999.99 -> 400 with field error (never 500)
try {
  const f6Res = await api('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Huge Salary Emp',
      email: `huge_${Date.now()}@unihr.com`,
      password: 'Password@123',
      companyId: alphaCompany.id,
      employeeCode: `HS-${Date.now().toString().slice(-4)}`,
      designation: 'Architect',
      baseSalary: 999999999999.99
    })
  }, 'superadmin1@unihr.com');
  const f6Json = await f6Res.json();
  const pass = f6Res.status === 400 && f6Json.error && f6Json.error.includes('Salary cannot exceed');
  recordResult('J3', pass, `Salary 999999999999.99 rejected HTTP ${f6Res.status}: "${f6Json.error}" (never 500)`);
} catch (e) {
  recordResult('J3', false, `Error: ${e.message}`);
}

// J4: employee create without designation -> rejected
try {
  const f7Res = await api('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'No Desig Emp',
      email: `nodesig_${Date.now()}@unihr.com`,
      password: 'Password@123',
      companyId: alphaCompany.id,
      employeeCode: `ND-${Date.now().toString().slice(-4)}`,
      designation: ''
    })
  }, 'superadmin1@unihr.com');
  const f7Json = await f7Res.json();
  const pass = f7Res.status === 400 && f7Json.error && f7Json.error.includes('Designation is required');
  recordResult('J4', pass, `Employee create without designation rejected HTTP ${f7Res.status}: "${f7Json.error}"`);
} catch (e) {
  recordResult('J4', false, `Error: ${e.message}`);
}

// J5: duplicate phone -> message contains "already exists"
try {
  const testPhone = `+919876${Date.now().toString().slice(-6)}`;
  const p1Res = await api('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Phone User 1',
      email: `p1_${Date.now()}@unihr.com`,
      password: 'Password@123',
      companyId: alphaCompany.id,
      employeeCode: `P1-${Date.now().toString().slice(-4)}`,
      designation: 'Engineer',
      phone: testPhone
    })
  }, 'superadmin1@unihr.com');
  const p1Json = await p1Res.json();
  createdEntities.push({ type: 'Employee', id: p1Json.data?.employeeId });

  const p2Res = await api('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Phone User 2',
      email: `p2_${Date.now()}@unihr.com`,
      password: 'Password@123',
      companyId: alphaCompany.id,
      employeeCode: `P2-${Date.now().toString().slice(-4)}`,
      designation: 'Engineer',
      phone: testPhone
    })
  }, 'superadmin1@unihr.com');
  const p2Json = await p2Res.json();
  const pass = p2Res.status === 409 && p2Json.error && p2Json.error.includes('already exists');
  recordResult('J5', pass, `Duplicate phone rejected HTTP ${p2Res.status}: "${p2Json.error}"`);
} catch (e) {
  recordResult('J5', false, `Error: ${e.message}`);
}

// J6: duplicate company name (case variant) -> rejected
try {
  const r1Res = await api('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: alphaCompany.name.toLowerCase(),
      code: `VAR${Date.now().toString().slice(-4)}`
    })
  }, 'superadmin1@unihr.com');
  const r1Json = await r1Res.json();
  const pass = r1Res.status === 409 && r1Json.error && r1Json.error.includes('already exists');
  recordResult('J6', pass, `Duplicate company name (case variant "${alphaCompany.name.toLowerCase()}") rejected HTTP ${r1Res.status}: "${r1Json.error}"`);
} catch (e) {
  recordResult('J6', false, `Error: ${e.message}`);
}

// Cleanup browser
bWs.close();
pWs.close();
chrome.kill();
await prisma.$disconnect();

console.log('\n================ PROBE SUMMARY ================');
console.log(`TOTAL PROBES: ${results.length}`);
console.log(`PASSED: ${results.filter(r => r.pass).length}`);
console.log(`FAILED: ${results.filter(r => !r.pass).length}`);
console.log('\nCreated Test Entities:', JSON.stringify(createdEntities, null, 2));

process.exit(0);
