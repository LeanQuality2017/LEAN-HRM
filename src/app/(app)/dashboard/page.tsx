import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAuth, getAdministeredCompanyIds, getEmployedCompanyIds } from '@/lib/api-auth'
import { isPayrollEnabled, isInstituteEnabled } from '@/lib/feature-gates'
import { StatCard } from '@/components/stat-card'
import { AttendanceWidget } from '@/components/attendance-widget'
import { NotificationsCard } from '@/components/notifications-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fmtDate, fmtMoney, ROLE_LABELS } from '@/lib/constants'
import { resolveAttendanceCompanyId } from '@/lib/attendance'
import {
  Users, CalendarCheck, CalendarX, FileText, Wallet, Briefcase,
  GraduationCap, Megaphone, ClipboardList, IndianRupee, Handshake, ArrowRight,
} from 'lucide-react'

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export default async function DashboardPage() {
  const auth = await getAuth()
  if (!auth) redirect('/login')
  const { role, userId, employeeId, name } = auth

  // Build announcement query where clause based on explicit scope
  let announcementWhere: Record<string, unknown> = {}
  if (role === 'SUPER_ADMIN') {
    announcementWhere = {} // Group scope sees all announcements
  } else if (role === 'COMPANY_ADMIN' || role === 'HR') {
    const adminCids = await getAdministeredCompanyIds(auth)
    if (adminCids && adminCids.length > 0) {
      announcementWhere = { OR: [{ companyId: null }, { companyId: { in: adminCids } }] }
    } else {
      announcementWhere = { companyId: null }
    }
  } else if (role === 'STUDENT') {
    const instCompanies = await db.company.findMany({ where: { type: 'INSTITUTE' }, select: { id: true } })
    const instCids = instCompanies.map((c) => c.id)
    announcementWhere = { OR: [{ companyId: null }, { companyId: { in: instCids } }] }
  } else {
    // MANAGER, EMPLOYEE
    const employedCids = await getEmployedCompanyIds(auth)
    if (employedCids.length > 0) {
      announcementWhere = { OR: [{ companyId: null }, { companyId: { in: employedCids } }] }
    } else {
      announcementWhere = { companyId: null }
    }
  }

  const [notifs, announcements] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.announcement.findMany({
      where: announcementWhere,
      orderBy: { createdAt: 'desc' },
      take: 4,
      include: { company: { select: { code: true } } },
    }),
  ])

  // ============ STUDENT DASHBOARD ============
  if (role === 'STUDENT') {
    const student = await db.student.findUnique({
      where: { userId },
      include: {
        enrollments: { include: { batch: { include: { course: true } } } },
        payments: { orderBy: { paidAt: 'desc' } },
        results: { include: { assessment: { include: { batch: { include: { course: true } } } } }, orderBy: { assessment: { date: 'desc' } } },
        placements: true,
      },
    })
    const totalPaid = student?.payments.reduce((s, p) => s + Number(p.amount), 0) ?? 0
    const courseFee = student?.enrollments[0]?.batch.course.fee ? Number(student.enrollments[0].batch.course.fee) : 0
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Welcome, {name} 👋</h1>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="My Status" value={student?.status ?? '—'} icon={GraduationCap} />
          <StatCard title="Enrolled Batches" value={student?.enrollments.length ?? 0} icon={ClipboardList} />
          <StatCard title="Fees Paid" value={fmtMoney(totalPaid)} sub={courseFee ? `of ${fmtMoney(courseFee)}` : undefined} icon={IndianRupee} tone="good" />
          <StatCard title="Placements" value={student?.placements.length ?? 0} icon={Handshake} tone={student?.placements.length ? 'good' : 'default'} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">My Assessments</CardTitle></CardHeader>
            <CardContent className="space-y-2 max-h-72 overflow-y-auto">
              {(student?.results ?? []).map((r) => (
                <div key={r.id} className="flex items-center justify-between border rounded-md p-2.5 text-sm">
                  <div>
                    <div className="font-medium">{r.assessment.title}</div>
                    <div className="text-xs text-muted-foreground">{r.assessment.batch.course.name} · {fmtDate(r.assessment.date)}</div>
                  </div>
                  <Badge variant="outline">{r.score}/{r.assessment.maxScore}</Badge>
                </div>
              ))}
              {!student?.results.length && <p className="text-sm text-muted-foreground text-center py-4">No assessments yet.</p>}
            </CardContent>
          </Card>
          <NotificationsCard items={notifs} />
        </div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">My Payments</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(student?.payments ?? []).map((p) => (
              <div key={p.id} className="flex items-center justify-between border rounded-md p-2.5 text-sm">
                <div><span className="font-medium">{p.invoiceNo}</span> · {p.method} · {fmtDate(p.paidAt)}</div>
                <div className="font-semibold">{fmtMoney(Number(p.amount))}</div>
              </div>
            ))}
            {!student?.payments.length && <p className="text-sm text-muted-foreground text-center py-4">No payments recorded.</p>}
          </CardContent>
        </Card>
      </div>
    )
  }

  // ============ SHARED / ADMIN / MANAGER DATA ============
  const today = startOfToday()
  const isSuperAdmin = role === 'SUPER_ADMIN'
  const isCompanyAdminOrHr = role === 'COMPANY_ADMIN' || role === 'HR'
  const isManager = role === 'MANAGER'
  const payrollAllowed = isPayrollEnabled()
  const instituteAllowed = isInstituteEnabled()

  if (isSuperAdmin || isCompanyAdminOrHr || isManager) {
    let empCount = 0
    let todayPresent = 0
    let pendingLeaves = 0
    let reportsToReview = 0
    let openJobs = 0
    let pendingApps = 0
    let students = 0
    let placed = 0
    let hasInstituteScope = false

    if (isSuperAdmin) {
      // Group access across all companies
      hasInstituteScope = instituteAllowed
      const [eCount, tPresent, pLeaves, rReview, oJobs, pApps, sCount, plCount] = await Promise.all([
        db.employee.count({ where: { status: 'ACTIVE' } }),
        db.attendance.count({ where: { date: today, checkIn: { not: null } } }),
        db.leaveRequest.count({ where: { status: 'PENDING' } }),
        db.dailyWorkReport.count({ where: { status: 'SUBMITTED', date: { lt: today } } }),
        db.jobOpening.count({ where: { status: 'OPEN' } }),
        db.jobApplication.count({ where: { status: { in: ['NEW', 'SCREENING'] } } }),
        instituteAllowed ? db.student.count() : 0,
        instituteAllowed ? db.student.count({ where: { status: 'PLACED' } }) : 0,
      ])
      empCount = eCount
      todayPresent = tPresent
      pendingLeaves = pLeaves
      reportsToReview = rReview
      openJobs = oJobs
      pendingApps = pApps
      students = sCount
      placed = plCount
    } else if (isCompanyAdminOrHr) {
      // Company access strictly scoped to administered company IDs
      const administeredCids = (await getAdministeredCompanyIds(auth)) || []
      if (administeredCids.length > 0) {
        const instCount = await db.company.count({ where: { id: { in: administeredCids }, type: 'INSTITUTE' } })
        hasInstituteScope = instituteAllowed && instCount > 0

        const [eCount, tPresent, pLeaves, rReview, oJobs, pApps, sCount, plCount] = await Promise.all([
          db.employee.count({ where: { status: 'ACTIVE', assignments: { some: { companyId: { in: administeredCids } } } } }),
          db.attendance.count({ where: { date: today, checkIn: { not: null }, companyId: { in: administeredCids } } }),
          db.leaveRequest.count({ where: { status: 'PENDING', employee: { assignments: { some: { companyId: { in: administeredCids } } } } } }),
          db.dailyWorkReport.count({ where: { status: 'SUBMITTED', date: { lt: today }, companyId: { in: administeredCids } } }),
          db.jobOpening.count({ where: { status: 'OPEN', companyId: { in: administeredCids } } }),
          db.jobApplication.count({ where: { status: { in: ['NEW', 'SCREENING'] }, jobOpening: { companyId: { in: administeredCids } } } }),
          hasInstituteScope ? db.student.count() : 0,
          hasInstituteScope ? db.student.count({ where: { status: 'PLACED' } }) : 0,
        ])
        empCount = eCount
        todayPresent = tPresent
        pendingLeaves = pLeaves
        reportsToReview = rReview
        openJobs = oJobs
        pendingApps = pApps
        students = sCount
        placed = plCount
      }
      // If administeredCids.length === 0: missing scope denies access; counts remain 0.
    } else if (isManager) {
      // Manager access strictly scoped to direct reports
      if (employeeId) {
        const [eCount, tPresent, pLeaves, rReview] = await Promise.all([
          db.employee.count({ where: { status: 'ACTIVE', managerId: employeeId } }),
          db.attendance.count({ where: { date: today, checkIn: { not: null }, employee: { managerId: employeeId } } }),
          db.leaveRequest.count({ where: { status: 'PENDING', employee: { managerId: employeeId } } }),
          db.dailyWorkReport.count({ where: { status: 'SUBMITTED', date: { lt: today }, employee: { managerId: employeeId } } }),
        ])
        empCount = eCount
        todayPresent = tPresent
        pendingLeaves = pLeaves
        reportsToReview = rReview
      }
    }

    const scopeSubtitle = isSuperAdmin
      ? 'Group overview across all companies'
      : isCompanyAdminOrHr
        ? 'Your company at a glance'
        : 'Your team at a glance'

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold">Good day, {name.split(' ')[0] ?? 'User'} 👋</h1>
            <p className="text-sm text-muted-foreground">{ROLE_LABELS[role]} · {scopeSubtitle}</p>
          </div>
        </div>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard title="Active Employees" value={empCount} icon={Users} />
          <StatCard title="Present Today" value={todayPresent} icon={CalendarCheck} tone="good" />
          <StatCard title="Pending Leaves" value={pendingLeaves} icon={CalendarX} tone={pendingLeaves ? 'warn' : 'default'} />
          <StatCard title="Reports to Review" value={reportsToReview} icon={FileText} tone={reportsToReview ? 'warn' : 'default'} />
          {!isManager && <StatCard title="Open Jobs" value={openJobs} icon={Briefcase} />}
          {!isManager && <StatCard title="New Candidates" value={pendingApps} icon={Users} />}
          {hasInstituteScope && <StatCard title="Institute Students" value={students} icon={GraduationCap} />}
          {hasInstituteScope && <StatCard title="Placed Students" value={placed} icon={Handshake} tone="good" />}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Quick Actions</CardTitle></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <Button asChild variant="outline" className="justify-start"><Link href="/leaves/approvals"><CalendarX className="h-4 w-4 mr-2" /> Review Leaves <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/work-reports"><FileText className="h-4 w-4 mr-2" /> Review Reports <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>
              {!isManager && <Button asChild variant="outline" className="justify-start"><Link href="/recruitment"><Briefcase className="h-4 w-4 mr-2" /> Recruitment <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>}
              {(isSuperAdmin || isCompanyAdminOrHr) && payrollAllowed && <Button asChild variant="outline" className="justify-start"><Link href="/payroll"><Wallet className="h-4 w-4 mr-2" /> Payroll <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>}
              {(isSuperAdmin || isCompanyAdminOrHr) && <Button asChild variant="outline" className="justify-start"><Link href="/employees"><Users className="h-4 w-4 mr-2" /> Employees <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>}
              {hasInstituteScope && <Button asChild variant="outline" className="justify-start"><Link href="/institute/students"><GraduationCap className="h-4 w-4 mr-2" /> Students <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>}
            </CardContent>
          </Card>
          <NotificationsCard items={notifs} />
        </div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Megaphone className="h-4 w-4 text-teal-700" /> Latest Announcements</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {announcements.map((a) => (
              <div key={a.id} className="border rounded-md p-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{a.title}</span>
                  {a.company ? <Badge variant="outline" className="text-[10px]">{a.company.code}</Badge> : <Badge className="bg-teal-700 text-[10px]">ALL</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.content}</p>
                <span className="text-[10px] text-muted-foreground">{fmtDate(a.createdAt)}</span>
              </div>
            ))}
            {!announcements.length && <p className="text-sm text-muted-foreground text-center py-4">No announcements.</p>}
          </CardContent>
        </Card>
      </div>
    )
  }

  // ============ EMPLOYEE DASHBOARD ============
  const todayAtt = employeeId
    ? await (async () => {
        try {
          const companyId = await resolveAttendanceCompanyId(employeeId)
          return await db.attendance.findUnique({
            where: { employeeId_companyId_date: { employeeId, companyId, date: today } },
          })
        } catch (err) {
          console.error('[attendance-scope]', err)
          return null
        }
      })()
    : null
  const [myLeaves, myReports, latestPayslip, myKpis] = await Promise.all([
    employeeId ? db.leaveRequest.count({ where: { employeeId, status: 'PENDING' } }) : Promise.resolve(0),
    employeeId ? db.dailyWorkReport.count({ where: { employeeId, status: 'SUBMITTED' } }) : Promise.resolve(0),
    employeeId && payrollAllowed ? db.payroll.findFirst({ where: { employeeId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] }) : null,
    employeeId ? db.kPI.findMany({ where: { employeeId }, take: 4 }) : Promise.resolve([]),
  ])
  const recentReports = employeeId ? await db.dailyWorkReport.findMany({ where: { employeeId }, orderBy: { date: 'desc' }, take: 3, include: { comments: { include: { user: { select: { name: true } } } } } }) : []

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Welcome, {name.split(' ')[0] ?? 'User'} 👋</h1>
      {employeeId && <AttendanceWidget checkIn={todayAtt?.checkIn?.toISOString() ?? null} checkOut={todayAtt?.checkOut?.toISOString() ?? null} />}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard title="Pending Leaves" value={myLeaves} icon={CalendarX} tone={myLeaves ? 'warn' : 'default'} />
        <StatCard title="Reports Awaiting Review" value={myReports} icon={FileText} tone={myReports ? 'warn' : 'default'} />
        {payrollAllowed && <StatCard title="Last Payslip" value={latestPayslip ? fmtMoney(Number(latestPayslip.netPay)) : '—'} sub={latestPayslip ? `${latestPayslip.month}/${latestPayslip.year} · ${latestPayslip.status}` : undefined} icon={Wallet} />}
        <StatCard title="My KPIs" value={myKpis.length} icon={ClipboardList} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">My Recent Work Reports</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {recentReports.map((r) => (
              <div key={r.id} className="border rounded-md p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{fmtDate(r.date)}</span>
                  <Badge variant={r.status === 'REVIEWED' ? 'default' : 'secondary'} className={r.status === 'REVIEWED' ? 'bg-teal-700 text-[10px]' : 'text-[10px]'}>{r.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.tasks}</p>
                {r.comments[0] && <p className="text-xs text-teal-800 mt-1">💬 {r.comments[0].user.name}: {r.comments[0].comment}</p>}
              </div>
            ))}
            {!recentReports.length && <p className="text-sm text-muted-foreground text-center py-4">No reports yet: submit your first EOD report from Work Reports.</p>}
          </CardContent>
        </Card>
        <NotificationsCard items={notifs} />
      </div>
    </div>
  )
}
