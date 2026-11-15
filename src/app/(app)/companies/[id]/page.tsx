export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requirePageAuth } from '@/lib/page-auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fmtDate } from '@/lib/constants'
import { CompanyActionButtons, AssignmentRowActions } from './drilldown-client'
import {
  Building2,
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  CalendarOff,
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  GraduationCap,
} from 'lucide-react'

export default async function CompanyDrillDownPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const auth = await requirePageAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'])
  const { role, administeredCompanyIds } = auth
  const isSuperAdmin = role === 'SUPER_ADMIN'
  const isCompanyAdmin = role === 'COMPANY_ADMIN'
  const isHr = role === 'HR'
  const isAdmin = isSuperAdmin || isCompanyAdmin

  const { id } = await params

  // Access control: SUPER_ADMIN any; COMPANY_ADMIN/HR only scoped; others 404
  if (!isSuperAdmin) {
    if (!administeredCompanyIds || !administeredCompanyIds.includes(id)) {
      notFound()
    }
  }

  const company = await db.company.findUnique({
    where: { id },
    include: {
      assignments: {
        include: {
          employee: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                  isActive: true,
                },
              },
            },
          },
        },
        orderBy: [{ isPrimary: 'desc' }, { employee: { employeeCode: 'asc' } }],
      },
    },
  })

  if (!company) notFound()

  // Headcount & Attendance stats
  const headcount = company.assignments.length

  const now = new Date()
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 86400000)

  const attendanceGroups = await db.attendance.groupBy({
    by: ['status'],
    where: {
      companyId: id,
      date: { gte: today, lt: tomorrow },
    },
    _count: {
      status: true,
    },
  })

  const statusMap = Object.fromEntries(attendanceGroups.map((g) => [g.status, g._count.status]))
  const presentCount = statusMap['PRESENT'] ?? 0
  const lateCount = statusMap['LATE'] ?? 0
  const absentCount = statusMap['ABSENT'] ?? 0
  const onLeaveCount = statusMap['LEAVE'] ?? 0

  const pendingLeaves = await db.leaveRequest.count({
    where: {
      status: 'PENDING',
      employee: {
        assignments: {
          some: { companyId: id },
        },
      },
    },
  })

  // Students if institute
  const isInstitute = company.type === 'INSTITUTE'
  const students = isInstitute
    ? await db.student.findMany({
        orderBy: { code: 'asc' },
        include: {
          enrollments: {
            include: {
              batch: {
                include: {
                  course: true,
                },
              },
            },
          },
        },
      })
    : []

  // Available employees for assignment modal (POOL_POLICY = b1)
  let candidateEmployees: { id: string; employeeCode: string; designation: string; user: { name: string } }[] = []
  if (isSuperAdmin) {
    candidateEmployees = await db.employee.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        employeeCode: true,
        designation: true,
        user: { select: { name: true } },
      },
      orderBy: { employeeCode: 'asc' },
    })
  } else if (isAdmin && administeredCompanyIds && administeredCompanyIds.length > 0) {
    candidateEmployees = await db.employee.findMany({
      where: {
        status: 'ACTIVE',
        assignments: {
          some: {
            companyId: { in: administeredCompanyIds },
          },
        },
      },
      select: {
        id: true,
        employeeCode: true,
        designation: true,
        user: { select: { name: true } },
      },
      orderBy: { employeeCode: 'asc' },
    })
  }

  const allEmployees = candidateEmployees.map((e) => ({
    id: e.id,
    employeeCode: e.employeeCode,
    designation: e.designation,
    user: {
      name: e.user.name,
      email: '',
    },
  }))

  return (
    <div className="space-y-4">
      {/* Navigation / Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground">
            <Link href="/companies">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Companies
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Building2 className="h-5 w-5 text-teal-700" />
                {company.name}
              </h1>
              <Badge
                className={
                  isInstitute
                    ? 'bg-violet-100 text-violet-800 border-0 text-[10px]'
                    : 'bg-teal-100 text-teal-800 border-0 text-[10px]'
                }
              >
                {isInstitute ? 'Training & Placement' : 'Company'}
              </Badge>
              {!company.isActive && (
                <Badge variant="destructive" className="text-[10px]">
                  DISABLED
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Code: {company.code} · Joined {fmtDate(company.createdAt)}
            </p>
          </div>
        </div>

        {isAdmin && (
          <CompanyActionButtons
            companyId={company.id}
            companyCode={company.code}
            isSuperAdmin={isSuperAdmin}
            availableEmployees={allEmployees}
          />
        )}
      </div>

      {/* Meta details if available */}
      {(company.address || company.email || company.phone) && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-lg border">
          {company.address && (
            <div className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {company.address}
            </div>
          )}
          {company.email && (
            <div className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" />
              {company.email}
            </div>
          )}
          {company.phone && (
            <div className="flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" />
              {company.phone}
            </div>
          )}
        </div>
      )}

      {/* Stat Row */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-teal-700" />
            <div className="text-xs text-muted-foreground">Headcount</div>
          </div>
          <div className="text-xl font-bold mt-1">{headcount}</div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <div className="text-xs text-muted-foreground">Present</div>
          </div>
          <div className="text-xl font-bold mt-1 text-emerald-700">{presentCount}</div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            <div className="text-xs text-muted-foreground">Late</div>
          </div>
          <div className="text-xl font-bold mt-1 text-amber-700">{lateCount}</div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-rose-600" />
            <div className="text-xs text-muted-foreground">Absent</div>
          </div>
          <div className="text-xl font-bold mt-1 text-rose-700">{absentCount}</div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <CalendarOff className="h-4 w-4 text-blue-600" />
            <div className="text-xs text-muted-foreground">On Leave</div>
          </div>
          <div className="text-xl font-bold mt-1 text-blue-700">{onLeaveCount}</div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-orange-600" />
            <div className="text-xs text-muted-foreground">Pending Leaves</div>
          </div>
          <div className="text-xl font-bold mt-1 text-orange-700">{pendingLeaves}</div>
        </Card>
      </div>

      {/* Main Content Tabs (Employees + conditional Students) */}
      <Tabs defaultValue="employees" className="w-full">
        <TabsList>
          <TabsTrigger value="employees" className="text-xs">
            Assigned Employees ({company.assignments.length})
          </TabsTrigger>
          {isInstitute && (
            <TabsTrigger value="students" className="text-xs">
              Students ({students.length})
            </TabsTrigger>
          )}
        </TabsList>

        {/* Tab 1: Employees Table */}
        <TabsContent value="employees" className="mt-3">
          <Card>
            <CardHeader className="py-3 px-4 border-b">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Assigned Staff</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {company.assignments.length} total assignments
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-muted-foreground text-left">
                      <th className="py-2.5 px-3 font-medium">Code</th>
                      <th className="py-2.5 px-3 font-medium">Name</th>
                      <th className="py-2.5 px-3 font-medium">Designation</th>
                      <th className="py-2.5 px-3 font-medium">Type</th>
                      <th className="py-2.5 px-3 font-medium">Status</th>
                      {isAdmin && <th className="py-2.5 px-3 font-medium text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {company.assignments.length === 0 ? (
                      <tr>
                        <td
                          colSpan={isAdmin ? 6 : 5}
                          className="py-8 text-center text-muted-foreground"
                        >
                          No employees assigned to this company.
                        </td>
                      </tr>
                    ) : (
                      company.assignments.map((a) => (
                        <tr key={a.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="py-2 px-3 font-mono text-[11px] font-semibold text-teal-800">
                            {a.employee.employeeCode}
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-medium text-foreground">
                              {a.employee.user.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {a.employee.user.email}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {a.designation}
                          </td>
                          <td className="py-2 px-3">
                            {a.isPrimary ? (
                              <Badge className="bg-teal-100 text-teal-800 border-0 text-[10px]">
                                Primary
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                Secondary
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <Badge
                              variant={a.employee.status === 'ACTIVE' ? 'default' : 'secondary'}
                              className={
                                a.employee.status === 'ACTIVE'
                                  ? 'bg-emerald-100 text-emerald-800 border-0 text-[10px]'
                                  : 'text-[10px]'
                              }
                            >
                              {a.employee.status}
                            </Badge>
                          </td>
                          {isAdmin && (
                            <td className="py-2 px-3 text-right">
                              <AssignmentRowActions
                                companyId={company.id}
                                assignment={{
                                  assignmentId: a.id,
                                  employeeId: a.employee.id,
                                  employeeCode: a.employee.employeeCode,
                                  name: a.employee.user.name,
                                  email: a.employee.user.email,
                                  designation: a.designation || a.employee.designation,
                                  isPrimary: a.isPrimary,
                                  status: a.employee.status,
                                }}
                              />
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Students Table (Institute only) */}
        {isInstitute && (
          <TabsContent value="students" className="mt-3">
            <Card>
              <CardHeader className="py-3 px-4 border-b">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <GraduationCap className="h-4 w-4 text-violet-700" />
                    Institute Students
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {students.length} total students
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/40 text-muted-foreground text-left">
                        <th className="py-2.5 px-3 font-medium">Student Code</th>
                        <th className="py-2.5 px-3 font-medium">Name</th>
                        <th className="py-2.5 px-3 font-medium">Course / Batch</th>
                        <th className="py-2.5 px-3 font-medium">Status</th>
                        <th className="py-2.5 px-3 font-medium">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-muted-foreground">
                            No students registered.
                          </td>
                        </tr>
                      ) : (
                        students.map((stu) => {
                          const primaryEnroll = stu.enrollments[0]
                          const courseBatch = primaryEnroll
                            ? `${primaryEnroll.batch.course.name} (${primaryEnroll.batch.name})`
                            : 'Not enrolled'
                          return (
                            <tr
                              key={stu.id}
                              className="border-b last:border-0 hover:bg-muted/20"
                            >
                              <td className="py-2 px-3 font-mono text-[11px] font-semibold text-violet-800">
                                {stu.code}
                              </td>
                              <td className="py-2 px-3">
                                <div className="font-medium text-foreground">{stu.name}</div>
                                {stu.email && (
                                  <div className="text-[10px] text-muted-foreground">
                                    {stu.email}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">
                                {courseBatch}
                              </td>
                              <td className="py-2 px-3">
                                <Badge
                                  className={
                                    stu.status === 'PLACED'
                                      ? 'bg-emerald-100 text-emerald-800 border-0 text-[10px]'
                                      : stu.status === 'ENROLLED'
                                      ? 'bg-teal-100 text-teal-800 border-0 text-[10px]'
                                      : 'bg-muted text-muted-foreground border-0 text-[10px]'
                                  }
                                >
                                  {stu.status}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">
                                {fmtDate(stu.createdAt)}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
