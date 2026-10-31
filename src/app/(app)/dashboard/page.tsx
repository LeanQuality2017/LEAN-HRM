import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { StatCard } from '@/components/stat-card'
import { AttendanceWidget } from '@/components/attendance-widget'
import { NotificationsCard } from '@/components/notifications-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fmtDate, fmtMoney, ROLE_LABELS } from '@/lib/constants'
import { Building2, Users, CalendarCheck, CalendarX, FileText, Wallet, Briefcase, GraduationCap, Megaphone, ClipboardList, IndianRupee, Handshake, ArrowRight } from 'lucide-react'

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')
  const role = session.user.role
  const userId = session.user.id
  const employeeId = session.user.employeeId

  const [notifs, announcements] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.announcement.findMany({
      where: role === 'STUDENT' ? {} : employeeId ? { OR: [{ companyId: null }, { companyId: { in: (await db.employeeCompanyAssignment.findMany({ where: { employeeId }, select: { companyId: true } })).map((a) => a.companyId) } }] } : {},
      orderBy: { createdAt: 'desc' }, take: 4,
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
        <h1 className="text-xl font-bold">Welcome, {session.user.name} 👋</h1>
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

  // ============ SHARED DATA ============
  const today = startOfToday()
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'].includes(role)
  const isManager = role === 'MANAGER'

  if (isAdmin || isManager) {
    const companyScope = isAdmin
      ? undefined
      : employeeId
        ? (await db.employeeCompanyAssignment.findMany({ where: { employeeId }, select: { companyId: true } })).map((a) => a.companyId)
        : []

    const [empCount, todayPresent, pendingLeaves, reportsToReview, pendingApps, openJobs, students, placed, upcomingPayroll, myApprovals] = await Promise.all([
      db.employee.count({ where: { status: 'ACTIVE', ...(companyScope ? { assignments: { some: { companyId: { in: companyScope } } } } : {}) } }),
      db.attendance.count({ where: { date: today, checkIn: { not: null }, ...(companyScope ? { companyId: { in: companyScope } } : {}) } }),
      db.leaveRequest.count({ where: { status: 'PENDING', ...(isAdmin && companyScope ? { employee: { assignments: { some: { companyId: { in: companyScope } } } } } : {}) } }),
      db.dailyWorkReport.count({ where: { status: 'SUBMITTED', date: { lt: today }, ...(isAdmin && companyScope ? { companyId: { in: companyScope } } : {}) } }),
      db.jobApplication.count({ where: { status: { in: ['NEW', 'SCREENING'] }, ...(companyScope ? { jobOpening: { companyId: { in: companyScope } } } : {}) } }),
      db.jobOpening.count({ where: { status: 'OPEN', ...(companyScope ? { companyId: { in: companyScope } } : {}) } }),
      db.student.count(),
      db.student.count({ where: { status: 'PLACED' } }),
      db.announcement.findMany({ where: companyScope ? { OR: [{ companyId: null }, { companyId: { in: companyScope } }] } : {}, orderBy: { createdAt: 'desc' }, take: 3, include: { company: { select: { code: true } } } }),
      isManager && employeeId
        ? db.leaveRequest.count({ where: { status: 'PENDING', employee: { managerId: employeeId } } })
        : Promise.resolve(0),
    ])

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold">Good day, {session.user.name?.split(' ')[0] ?? 'User'} 👋</h1>
            <p className="text-sm text-muted-foreground">{ROLE_LABELS[role]} · {isAdmin ? 'All companies at a glance' : 'Your team at a glance'}</p>
          </div>
        </div>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard title="Active Employees" value={empCount} icon={Users} />
          <StatCard title="Present Today" value={todayPresent} icon={CalendarCheck} tone="good" />
          <StatCard title="Pending Leaves" value={pendingLeaves + myApprovals} icon={CalendarX} tone="warn" />
          <StatCard title="Reports to Review" value={reportsToReview} icon={FileText} tone="warn" />
          <StatCard title="Open Jobs" value={openJobs} icon={Briefcase} />
          <StatCard title="New Candidates" value={pendingApps} icon={Users} />
          <StatCard title="Institute Students" value={students} icon={GraduationCap} />
          <StatCard title="Placed Students" value={placed} icon={Handshake} tone="good" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Quick Actions</CardTitle></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <Button asChild variant="outline" className="justify-start"><Link href="/leaves/approvals"><CalendarX className="h-4 w-4 mr-2" /> Review Leaves <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/work-reports"><FileText className="h-4 w-4 mr-2" /> Review Reports <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/recruitment"><Briefcase className="h-4 w-4 mr-2" /> Recruitment <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>
              {isAdmin && <Button asChild variant="outline" className="justify-start"><Link href="/payroll"><Wallet className="h-4 w-4 mr-2" /> Payroll <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>}
              {isAdmin && <Button asChild variant="outline" className="justify-start"><Link href="/employees"><Users className="h-4 w-4 mr-2" /> Employees <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>}
              {isAdmin && <Button asChild variant="outline" className="justify-start"><Link href="/institute/students"><GraduationCap className="h-4 w-4 mr-2" /> Students <ArrowRight className="h-3 w-3 ml-auto" /></Link></Button>}
            </CardContent>
          </Card>
          <NotificationsCard items={notifs} />
        </div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Megaphone className="h-4 w-4 text-teal-700" /> Latest Announcements</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {upcomingPayroll.map((a) => (
              <div key={a.id} className="border rounded-md p-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{a.title}</span>
                  {a.company ? <Badge variant="outline" className="text-[10px]">{a.company.code}</Badge> : <Badge className="bg-teal-700 text-[10px]">ALL</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.content}</p>
                <span className="text-[10px] text-muted-foreground">{fmtDate(a.createdAt)}</span>
              </div>
            ))}
            {!upcomingPayroll.length && <p className="text-sm text-muted-foreground text-center py-4">No announcements.</p>}
          </CardContent>
        </Card>
      </div>
    )
  }

  // ============ EMPLOYEE DASHBOARD ============
  const todayAtt = employeeId ? await db.attendance.findUnique({ where: { employeeId_date: { employeeId, date: today } } }) : null
  const [myLeaves, myReports, latestPayslip, myKpis] = await Promise.all([
    employeeId ? db.leaveRequest.count({ where: { employeeId, status: 'PENDING' } }) : Promise.resolve(0),
    employeeId ? db.dailyWorkReport.count({ where: { employeeId, status: 'SUBMITTED' } }) : Promise.resolve(0),
    employeeId ? db.payroll.findFirst({ where: { employeeId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] }) : null,
    employeeId ? db.kPI.findMany({ where: { employeeId }, take: 4 }) : Promise.resolve([]),
  ])
  const recentReports = employeeId ? await db.dailyWorkReport.findMany({ where: { employeeId }, orderBy: { date: 'desc' }, take: 3, include: { comments: { include: { user: { select: { name: true } } } } } }) : []

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Welcome, {session.user.name?.split(' ')[0] ?? 'User'} 👋</h1>
      {employeeId && <AttendanceWidget checkIn={todayAtt?.checkIn?.toISOString() ?? null} checkOut={todayAtt?.checkOut?.toISOString() ?? null} />}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard title="Pending Leaves" value={myLeaves} icon={CalendarX} tone={myLeaves ? 'warn' : 'default'} />
        <StatCard title="Reports Awaiting Review" value={myReports} icon={FileText} tone={myReports ? 'warn' : 'default'} />
        <StatCard title="Last Payslip" value={latestPayslip ? fmtMoney(Number(latestPayslip.netPay)) : '—'} sub={latestPayslip ? `${latestPayslip.month}/${latestPayslip.year} · ${latestPayslip.status}` : undefined} icon={Wallet} />
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
