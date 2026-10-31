import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AttendanceWidget } from '@/components/attendance-widget'
import { AttendanceEditButton } from './edit-button'
import { fmtDate, fmtTime, todayISO, HR_ROLES } from '@/lib/constants'
import { CalendarCheck, Download, Search } from 'lucide-react'
import { PaginationControls } from '@/components/pagination-controls'

function statusBadge(s: string) {
  const map: Record<string, string> = {
    PRESENT: 'bg-emerald-100 text-emerald-800', LATE: 'bg-amber-100 text-amber-800',
    HALF_DAY: 'bg-orange-100 text-orange-800', ABSENT: 'bg-red-100 text-red-800',
    LEAVE: 'bg-sky-100 text-sky-800', WFH: 'bg-violet-100 text-violet-800', HOLIDAY: 'bg-gray-100 text-gray-700',
  }
  return <Badge className={`${map[s] ?? 'bg-gray-100'} text-[10px] border-0`}>{s.replaceAll('_', ' ')}</Badge>
}

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string; companyId?: string; page?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')
  const role = session.user.role
  const employeeId = session.user.employeeId
  const sp = await searchParams
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER'].includes(role)
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const companies = isAdmin && role !== 'MANAGER'
    ? await db.company.findMany({ select: { id: true, name: true, code: true }, orderBy: { createdAt: 'asc' } })
    : []

  const today = startOfToday()
  const dateFilter = sp.date ? { gte: new Date(sp.date), lt: new Date(new Date(sp.date).getTime() + 86400000) } : undefined

  const where: Record<string, unknown> = {}
  if (isAdmin) {
    if (role === 'MANAGER' && employeeId) where.employee = { managerId: employeeId }
    if (sp.companyId) where.companyId = sp.companyId
  } else if (employeeId) {
    where.employeeId = employeeId
  }
  if (dateFilter) where.date = dateFilter

  const [total, records] = await Promise.all([
    db.attendance.count({ where }),
    db.attendance.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take: pageSize,
      include: { employee: { select: { employeeCode: true, user: { select: { name: true } } } }, company: { select: { code: true } } },
    }),
  ])

  const myToday = employeeId ? await db.attendance.findUnique({ where: { employeeId_date: { employeeId, date: today } } }) : null

  const exportFrom = sp.date || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const exportTo = sp.date || new Date().toISOString().slice(0, 10)
  const exportUrl = `/api/export/attendance?from=${exportFrom}&to=${exportTo}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">Attendance</h1>
        {HR_ROLES.includes(role) && (
          <Button asChild variant="outline" size="sm">
            <a href={exportUrl} download>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </a>
          </Button>
        )}
      </div>
      {!isAdmin && employeeId && (
        <AttendanceWidget checkIn={myToday?.checkIn?.toISOString() ?? null} checkOut={myToday?.checkOut?.toISOString() ?? null} />
      )}

      {isAdmin && (
        <form className="flex flex-wrap items-center gap-2">
          <Input type="date" name="date" defaultValue={sp.date ?? ''} className="w-40" />
          {(role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN' || role === 'HR') && (
            <select name="companyId" defaultValue={sp.companyId ?? ''} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <Button type="submit" variant="outline" size="sm"><Search className="h-4 w-4 mr-1" /> Filter</Button>
          <Button asChild variant="ghost" size="sm"><a href="/attendance">Reset</a></Button>
        </form>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                <tr>
                  <th className="p-3 font-medium">Date</th>
                  {isAdmin && <th className="p-3 font-medium">Employee</th>}
                  {isAdmin && <th className="p-3 font-medium">Co.</th>}
                  <th className="p-3 font-medium">In</th>
                  <th className="p-3 font-medium">Out</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Source</th>
                  {['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'].includes(role) && <th className="p-3 font-medium"></th>}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/40">
                    <td className="p-3 whitespace-nowrap">{fmtDate(r.date)}</td>
                    {isAdmin && <td className="p-3"><div className="font-medium">{r.employee.user.name}</div><div className="text-xs text-muted-foreground">{r.employee.employeeCode}</div></td>}
                    {isAdmin && <td className="p-3"><Badge variant="outline" className="text-[10px]">{r.company.code}</Badge></td>}
                    <td className="p-3 whitespace-nowrap">{fmtTime(r.checkIn)}</td>
                    <td className="p-3 whitespace-nowrap">{fmtTime(r.checkOut)}</td>
                    <td className="p-3">{statusBadge(r.status)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{r.source}</td>
                    {['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'].includes(role) && (
                      <td className="p-3"><AttendanceEditButton id={r.id} status={r.status} note={r.note} /></td>
                    )}
                  </tr>
                ))}
                {!records.length && (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground"><CalendarCheck className="h-8 w-8 mx-auto mb-2 opacity-40" />No attendance records found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={page}
            pageSize={pageSize}
            total={total}
            baseUrl="/attendance"
            searchParams={{ date: sp.date, companyId: sp.companyId }}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
