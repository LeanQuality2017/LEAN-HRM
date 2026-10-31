/**
 * UniHR Seed — 3 companies, all 6 roles, sample data for every module.
 * Run: bun prisma/seed.ts
 * All demo passwords: Password@123
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'

const db = new PrismaClient()
const PWD = hashPassword('Password@123')

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}
function at(base: Date, h: number, m = 0): Date {
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

async function main() {
  console.log('🌱 Clearing old data...')
  await db.$transaction([
    db.auditLog.deleteMany(), db.notification.deleteMany(), db.announcement.deleteMany(), db.placement.deleteMany(),
    db.assessmentResult.deleteMany(), db.assessment.deleteMany(), db.feePayment.deleteMany(),
    db.studentEnrollment.deleteMany(), db.batch.deleteMany(), db.course.deleteMany(),
    db.student.deleteMany(), db.kPI.deleteMany(), db.performanceReview.deleteMany(),
    db.jobApplication.deleteMany(), db.jobOpening.deleteMany(), db.workReportComment.deleteMany(),
    db.dailyWorkReport.deleteMany(), db.payroll.deleteMany(), db.leaveRequest.deleteMany(),
    db.leaveType.deleteMany(), db.attendance.deleteMany(), db.employeeCompanyAssignment.deleteMany(),
    db.userCompanyScope.deleteMany(), db.employee.deleteMany(), db.user.deleteMany(), db.department.deleteMany(), db.company.deleteMany(),
  ])

  console.log('🌱 Creating companies...')
  const [alpha, beta, skill] = await Promise.all([
    db.company.create({ data: { name: 'Alpha Technologies', code: 'ALPHA', type: 'NORMAL', email: 'hr@alpha.com', phone: '+91 98400 11001', address: 'Tidel Park, Chennai' } }),
    db.company.create({ data: { name: 'Beta Solutions', code: 'BETA', type: 'NORMAL', email: 'hr@beta.com', phone: '+91 98400 11002', address: 'HITEC City, Hyderabad' } }),
    db.company.create({ data: { name: 'SkillEdge Academy — Training & Placement', code: 'SKILL', type: 'INSTITUTE', email: 'admin@skilledge.com', phone: '+91 98400 11003', address: 'Anna Nagar, Chennai' } }),
  ])

  console.log('🌱 Creating users & employees...')
  const mkUser = (email: string, name: string, role: string, phone?: string) =>
    db.user.create({ data: { email, name, role, phone, passwordHash: PWD } })

  const superAdmin = await mkUser('superadmin1@unihr.com', 'Super Admin 1', 'SUPER_ADMIN', '+91 90000 00000')
  const adminA = await mkUser('admin1@unihr.com', 'Admin 1', 'COMPANY_ADMIN')
  const hrA = await mkUser('hr1@unihr.com', 'HR 1', 'HR')
  const mgrA = await mkUser('manager1@unihr.com', 'Manager 1', 'MANAGER')
  const empA1 = await mkUser('employee1@unihr.com', 'Employee 1', 'EMPLOYEE')
  const empA2 = await mkUser('employee2@unihr.com', 'Employee 2', 'EMPLOYEE')
  const adminB = await mkUser('admin2@unihr.com', 'Admin 2', 'COMPANY_ADMIN')
  const hrB = await mkUser('hr2@unihr.com', 'HR 2', 'HR')
  const mgrB = await mkUser('manager2@unihr.com', 'Manager 2', 'MANAGER')
  const empB1 = await mkUser('employee3@unihr.com', 'Employee 3', 'EMPLOYEE')
  // Shared employee: works for BOTH Alpha & Beta, single login
  const sharedU = await mkUser('employee4@unihr.com', 'Employee 4', 'EMPLOYEE')
  const studU1 = await mkUser('student1@unihr.com', 'Student 1', 'STUDENT')
  const studU2 = await mkUser('student2@unihr.com', 'Student 2', 'STUDENT')

  await db.userCompanyScope.createMany({
    data: [
      { userId: adminA.id, companyId: alpha.id },
      { userId: hrA.id, companyId: alpha.id },
      { userId: adminB.id, companyId: beta.id },
      { userId: hrB.id, companyId: beta.id },
    ],
  })

  const mkEmp = async (userId: string, code: string, designation: string, salary: number, managerId?: string, days: number = 400) =>
    db.employee.create({ data: { userId, employeeCode: code, designation, baseSalary: salary, managerId, joinedAt: daysAgo(days) } })

  const eMgrA = await mkEmp(mgrA.id, 'ALPHA-M001', 'Engineering Manager', 140000)
  const eA1 = await mkEmp(empA1.id, 'ALPHA-E001', 'Software Engineer', 70000, eMgrA.id)
  const eA2 = await mkEmp(empA2.id, 'ALPHA-E002', 'QA Engineer', 55000, eMgrA.id)
  const eMgrB = await mkEmp(mgrB.id, 'BETA-M001', 'Operations Manager', 130000)
  const eB1 = await mkEmp(empB1.id, 'BETA-E001', 'Support Specialist', 45000, eMgrB.id)
  const eShared = await mkEmp(sharedU.id, 'GRP-E001', 'Full-stack Developer (Shared)', 90000, eMgrA.id, 600)

  await db.employeeCompanyAssignment.createMany({ data: [
    { employeeId: eMgrA.id, companyId: alpha.id, isPrimary: true },
    { employeeId: eA1.id, companyId: alpha.id, isPrimary: true },
    { employeeId: eA2.id, companyId: alpha.id, isPrimary: true },
    { employeeId: eMgrB.id, companyId: beta.id, isPrimary: true },
    { employeeId: eB1.id, companyId: beta.id, isPrimary: true },
    { employeeId: eShared.id, companyId: alpha.id, isPrimary: true, designation: 'Sr. Developer' },
    { employeeId: eShared.id, companyId: beta.id, isPrimary: false, designation: 'Consultant (2 days/week)' },
  ]})

  await db.department.createMany({ data: [
    { companyId: alpha.id, name: 'Engineering' }, { companyId: alpha.id, name: 'HR' }, { companyId: alpha.id, name: 'QA' },
    { companyId: beta.id, name: 'Operations' }, { companyId: beta.id, name: 'Support' },
    { companyId: skill.id, name: 'Training' }, { companyId: skill.id, name: 'Placement Cell' },
  ]})

  const [casualA, sickA] = await Promise.all([
    db.leaveType.create({ data: { companyId: alpha.id, name: 'Casual Leave', daysPerYear: 12 } }),
    db.leaveType.create({ data: { companyId: alpha.id, name: 'Sick Leave', daysPerYear: 8 } }),
  ])
  await db.leaveType.createMany({ data: [
    { companyId: beta.id, name: 'Casual Leave', daysPerYear: 12 },
    { companyId: beta.id, name: 'Sick Leave', daysPerYear: 8 },
  ]})

  console.log('🌱 Attendance, leaves, work reports...')
  const staff = [eMgrA, eA1, eA2, eMgrB, eB1, eShared]
  for (let d = 1; d <= 7; d++) {
    for (const e of staff) {
      const date = daysAgo(d)
      if (date.getDay() === 0) continue // skip Sundays
      const late = Math.random() < 0.15
      const inH = late ? 10 : 9, inM = late ? 25 : Math.floor(Math.random() * 15)
      const outH = 18 + Math.floor(Math.random() * 2)
      const assignments = await db.employeeCompanyAssignment.findMany({ where: { employeeId: e.id } })
      for (const a of assignments) {
        if (Math.random() < 0.5) continue // one record per company per ~2 days
        await db.attendance.create({ data: {
          employeeId: e.id, companyId: a.companyId, date,
          checkIn: at(date, inH, inM), checkOut: at(date, outH, 15),
          status: late ? 'LATE' : 'PRESENT', source: Math.random() < 0.3 ? 'BIOMETRIC' : 'WEB',
        }})
        break
      }
    }
  }
  // today's attendance for demo (not checked out yet)
  const today = daysAgo(0)
  for (const e of [eA1, eShared]) {
    await db.attendance.upsert({
      where: { employeeId_date: { employeeId: e.id, date: today } },
      update: {},
      create: { employeeId: e.id, companyId: alpha.id, date: today, checkIn: at(today, 9, 5), status: 'PRESENT', source: 'WEB' },
    })
  }

  await db.leaveRequest.createMany({ data: [
    { employeeId: eA1.id, leaveTypeId: casualA.id, startDate: daysAgo(-3), endDate: daysAgo(-4), days: 2, reason: 'Family function at native place', status: 'PENDING' },
    { employeeId: eA2.id, leaveTypeId: sickA.id, startDate: daysAgo(2), endDate: daysAgo(2), days: 1, reason: 'Fever and cold', status: 'APPROVED', reviewedById: mgrA.id, reviewComment: 'Get well soon', reviewedAt: daysAgo(2) },
    { employeeId: eB1.id, leaveTypeId: (await db.leaveType.findFirst({ where: { companyId: beta.id, name: 'Casual Leave' } }))!.id, startDate: daysAgo(-1), endDate: daysAgo(-1), days: 1, reason: 'Personal work', status: 'PENDING' },
  ]})

  for (const e of [eA1, eA2, eB1, eShared]) {
    for (let d = 1; d <= 5; d++) {
      const date = daysAgo(d)
      if (date.getDay() === 0) continue
      const rep = await db.dailyWorkReport.create({ data: {
        employeeId: e.id, companyId: alpha.id, date,
        tasks: d % 2 === 0
          ? 'Completed sprint tickets: API integration for payroll module, fixed 3 bugs, code review for team.'
          : 'Worked on client requirement doc, attended standup, unit tests for attendance service (92% coverage).',
        hoursWorked: 8 + (d % 3), blockers: d === 3 ? 'Waiting on staging DB access' : null,
      }})
      if (d >= 3) {
        await db.workReportComment.create({ data: { reportId: rep.id, userId: mgrA.id, comment: 'Good progress. Please prioritise the pending bug fix tomorrow.' } })
        await db.dailyWorkReport.update({ where: { id: rep.id }, data: { status: 'REVIEWED' } })
      }
    }
  }

  console.log('🌱 Payroll, recruitment, performance...')
  const now = new Date()
  const lastM = now.getMonth() === 0 ? 12 : now.getMonth(), lastY = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  for (const e of staff) {
    const base = Number(e.baseSalary)
    const allowances = Math.round(base * 0.12)
    const deductions = Math.round(base * 0.05)
    await db.payroll.create({ data: {
      employeeId: e.id, month: lastM, year: lastY, basic: base,
      allowances, deductions,
      netPay: base + allowances - deductions,
      status: 'PAID', paidAt: daysAgo(25), generatedById: hrA.id,
    }})
  }
  const baseA1 = Number(eA1.baseSalary)
  const allowancesA1 = Math.round(baseA1 * 0.12)
  const deductionsA1 = Math.round(baseA1 * 0.05)
  await db.payroll.create({ data: {
    employeeId: eA1.id, month: now.getMonth() + 1, year: now.getFullYear(), basic: baseA1,
    allowances: allowancesA1, deductions: deductionsA1,
    netPay: baseA1 + allowancesA1 - deductionsA1,
    status: 'DRAFT', generatedById: hrA.id,
  }})

  const job1 = await db.jobOpening.create({ data: { companyId: alpha.id, title: 'Senior React Developer', department: 'Engineering', description: '5+ yrs React/Next.js, TypeScript, REST APIs.', openings: 2 } })
  const job2 = await db.jobOpening.create({ data: { companyId: alpha.id, title: 'HR Executive', department: 'HR', description: '2+ yrs recruitment & onboarding experience.', openings: 1 } })
  const job3 = await db.jobOpening.create({ data: { companyId: beta.id, title: 'Customer Success Lead', department: 'Support', description: 'Handle enterprise clients, 4+ yrs.', openings: 1 } })
  await db.jobApplication.createMany({ data: [
    { jobOpeningId: job1.id, name: 'Suresh Babu', email: 'suresh@mail.com', phone: '+91 98111 22334', experience: 6, status: 'INTERVIEW', resumeNote: 'Ex-Zoho, React + Node expert' },
    { jobOpeningId: job1.id, name: 'Lakshmi P', email: 'lakshmi@mail.com', phone: '+91 98222 33445', experience: 3, status: 'SCREENING', resumeNote: 'React dev, 3 yrs fintech' },
    { jobOpeningId: job2.id, name: 'Harini V', email: 'harini@mail.com', phone: '+91 98333 44556', experience: 4, status: 'NEW' },
    { jobOpeningId: job3.id, name: 'Imran S', email: 'imran@mail.com', phone: '+91 98444 55667', experience: 5, status: 'OFFER', resumeNote: 'CS lead at Freshworks' },
  ]})

  await db.performanceReview.createMany({ data: [
    { employeeId: eA1.id, reviewerId: mgrA.id, period: '2026-Q2', goals: 'Deliver payroll module; improve test coverage to 90%; mentor interns', rating: 4.5, comments: 'Consistently strong delivery. Ready for next level.', status: 'COMPLETED' },
    { employeeId: eA2.id, reviewerId: mgrA.id, period: '2026-Q3', goals: 'Automate regression suite; reduce escaped bugs by 30%', status: 'PENDING' },
    { employeeId: eShared.id, reviewerId: mgrA.id, period: '2026-Q2', goals: 'Lead cross-company API standardisation', rating: 4.0, comments: 'Excellent cross-team collaboration.', status: 'COMPLETED' },
  ]})
  await db.kPI.createMany({ data: [
    { employeeId: eA1.id, title: 'Sprint Velocity', target: 40, achieved: 36, unit: 'pts', period: '2026-Q3' },
    { employeeId: eA1.id, title: 'Bug Fix SLA', target: 95, achieved: 97, unit: '%', period: '2026-Q3' },
    { employeeId: eShared.id, title: 'Cross-company Delivery', target: 100, achieved: 88, unit: '%', period: '2026-Q3' },
    { employeeId: eB1.id, title: 'CSAT Score', target: 90, achieved: 92, unit: '%', period: '2026-Q3' },
  ]})

  console.log('🌱 Institute: courses, batches, students, fees, assessments, placements...')
  const [pyCourse, dmCourse] = await Promise.all([
    db.course.create({ data: { name: 'Python Full-stack Development', code: 'PYFS', description: 'Python, Django, React, MySQL, deployment.', durationWeeks: 16, fee: 45000 } }),
    db.course.create({ data: { name: 'Digital Marketing Pro', code: 'DMKT', description: 'SEO, SEM, social media, analytics.', durationWeeks: 10, fee: 25000 } }),
  ])
  const b1 = await db.batch.create({ data: { courseId: pyCourse.id, name: 'PYFS-2026-Morning', startDate: daysAgo(40), endDate: daysAgo(-70), capacity: 30, status: 'ONGOING' } })
  const b2 = await db.batch.create({ data: { courseId: dmCourse.id, name: 'DMKT-2026-Evening', startDate: daysAgo(20), endDate: daysAgo(-50), capacity: 25, status: 'ONGOING' } })
  const b3 = await db.batch.create({ data: { courseId: pyCourse.id, name: 'PYFS-2026-Dec', startDate: daysAgo(-30), endDate: daysAgo(-170), capacity: 30, status: 'UPCOMING' } })

  const mkStudent = async (userId: string | null, code: string, name: string, email: string, phone: string, qual: string, status: string) =>
    db.student.create({ data: { userId, code, name, email, phone, qualification: qual, status } })
  const s1 = await mkStudent(studU1.id, 'STU-0001', 'Student 1', 'student1@mail.com', '+91 99111 20001', 'B.E. CSE', 'IN_TRAINING')
  const s2 = await mkStudent(studU2.id, 'STU-0002', 'Student 2', 'student2@mail.com', '+91 99111 20002', 'B.Sc IT', 'IN_TRAINING')
  const s3 = await mkStudent(null, 'STU-0003', 'Student 3', 'student3@mail.com', '+91 99111 20003', 'B.Com', 'PLACED')
  const s4 = await mkStudent(null, 'STU-0004', 'Student 4', 'student4@mail.com', '+91 99111 20004', 'BBA', 'ENROLLED')
  const s5 = await mkStudent(null, 'STU-0005', 'Student 5', 'student5@mail.com', '+91 99111 20005', 'Diploma CSE', 'ENQUIRY')

  await db.studentEnrollment.createMany({ data: [
    { studentId: s1.id, batchId: b1.id }, { studentId: s2.id, batchId: b1.id },
    { studentId: s3.id, batchId: b1.id, status: 'COMPLETED' }, { studentId: s4.id, batchId: b2.id },
  ]})

  await db.feePayment.createMany({ data: [
    { studentId: s1.id, amount: 25000, method: 'UPI', invoiceNo: 'INV-2026-0001', paidAt: daysAgo(38), note: 'Installment 1', receivedById: adminA.id },
    { studentId: s1.id, amount: 20000, method: 'BANK', invoiceNo: 'INV-2026-0002', paidAt: daysAgo(10), note: 'Installment 2', receivedById: adminA.id },
    { studentId: s2.id, amount: 45000, method: 'CARD', invoiceNo: 'INV-2026-0003', paidAt: daysAgo(39), note: 'Full payment', receivedById: adminA.id },
    { studentId: s3.id, amount: 45000, method: 'CASH', invoiceNo: 'INV-2026-0004', paidAt: daysAgo(150), receivedById: adminA.id },
    { studentId: s4.id, amount: 12500, method: 'UPI', invoiceNo: 'INV-2026-0005', paidAt: daysAgo(19), note: 'Installment 1', receivedById: adminA.id },
  ]})

  const a1 = await db.assessment.create({ data: { batchId: b1.id, title: 'Module 3 — Django REST Framework', date: daysAgo(12), maxScore: 100 } })
  const a2 = await db.assessment.create({ data: { batchId: b1.id, title: 'Module 4 — React Fundamentals', date: daysAgo(3), maxScore: 50 } })
  await db.assessmentResult.createMany({ data: [
    { assessmentId: a1.id, studentId: s1.id, score: 82, remarks: 'Good API design' },
    { assessmentId: a1.id, studentId: s2.id, score: 74 },
    { assessmentId: a1.id, studentId: s3.id, score: 91, remarks: 'Topper' },
    { assessmentId: a2.id, studentId: s1.id, score: 41 },
    { assessmentId: a2.id, studentId: s2.id, score: 38 },
  ]})

  await db.placement.createMany({ data: [
    { studentId: s3.id, companyName: 'Zoho Corporation', role: 'Python Developer', salary: 550000, placedAt: daysAgo(15), status: 'JOINED' },
    { studentId: s2.id, companyName: 'TCS', role: 'Trainee Developer', salary: 350000, placedAt: daysAgo(2), status: 'PLACED' },
  ]})

  console.log('🌱 Announcements & notifications...')
  await db.announcement.createMany({ data: [
    { title: 'Welcome to UniHR', content: 'Unified HRMS for Alpha Technologies, Beta Solutions and SkillEdge Academy is now live. Please complete your profile.', createdById: superAdmin.id },
    { companyId: alpha.id, title: 'Quarterly Town Hall — Friday 4 PM', content: 'All Alpha employees to attend the Q3 town hall in Auditorium A.', createdById: adminA.id },
    { companyId: skill.id, title: 'New Batch: Python Full-stack (Dec)', content: 'Admissions open for the December batch. Refer candidates to the front office.', createdById: adminB.id },
  ]})
  await db.notification.createMany({ data: [
    { userId: mgrA.id, title: 'Leave request pending', message: 'Employee 1 requested 2 days casual leave.', link: '/leaves/approvals' },
    { userId: hrA.id, title: 'New job application', message: 'Harini V applied for HR Executive.', link: '/recruitment' },
    { userId: empA1.id, title: 'Payslip generated', message: 'Your payslip is ready for review.', link: '/payroll' },
  ]})

  const counts = {
    companies: await db.company.count(), users: await db.user.count(), employees: await db.employee.count(),
    attendance: await db.attendance.count(), reports: await db.dailyWorkReport.count(), students: await db.student.count(),
  }
  console.log('✅ Seed complete:', counts)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
