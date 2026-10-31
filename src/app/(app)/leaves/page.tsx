import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ApplyLeaveButton } from './apply-button'
import { fmtDate } from '@/lib/constants'
import { CalendarX } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { PaginationControls } from '@/components/pagination-controls'

function statusBadge(s: string) {
  const map: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800', APPROVED: 'bg-emerald-100 text-emerald-800',
    REJECTED: 'bg-red-100 text-red-800', CANCELLED: 'bg-gray-100 text-gray-700',
  }
  return <Badge className={`${map[s]} text-[10px] border-0`}>{s}</Badge>
}

export default async function LeavesPage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')
  const role = session.user.role
  const employeeId = session.user.employeeId
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER'].includes(role)
  const sp = searchParams ? await searchParams : {}
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const [total, myLeaves] = employeeId
    ? await Promise.all([
        db.leaveRequest.count({ where: { employeeId } }),
        db.leaveRequest.findMany({
          where: { employeeId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: { leaveType: { select: { name: true } }, reviewedBy: { select: { name: true } } },
        }),
      ])
    : [0, []]

  // Leave types available to this user: from their assigned companies
  const companyIds = employeeId
    ? (await db.employeeCompanyAssignment.findMany({ where: { employeeId }, select: { companyId: true } })).map((a) => a.companyId)
    : []
  const leaveTypes = employeeId
    ? await db.leaveType.findMany({ where: { companyId: { in: companyIds.length ? companyIds : [''] } } })
    : []
  if (!leaveTypes.length) {
    // admins without an employee record can apply using any company's leave types
    leaveTypes.push(...(await db.leaveType.findMany({})))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">My Leaves</h1>
        <div className="flex gap-2">
          {isAdmin && <Button asChild variant="outline"><Link href="/leaves/approvals">Review Requests</Link></Button>}
          {employeeId && leaveTypes.length > 0 && <ApplyLeaveButton leaveTypes={leaveTypes} />}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                <tr>
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 font-medium">From</th>
                  <th className="p-3 font-medium">To</th>
                  <th className="p-3 font-medium">Days</th>
                  <th className="p-3 font-medium">Reason</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Reviewer</th>
                </tr>
              </thead>
              <tbody>
                {myLeaves.map((l) => (
                  <tr key={l.id} className="border-t hover:bg-muted/40">
                    <td className="p-3 font-medium">{l.leaveType.name}</td>
                    <td className="p-3 whitespace-nowrap">{fmtDate(l.startDate)}</td>
                    <td className="p-3 whitespace-nowrap">{fmtDate(l.endDate)}</td>
                    <td className="p-3">{l.days}</td>
                    <td className="p-3 max-w-[220px] truncate" title={l.reason}>{l.reason}</td>
                    <td className="p-3">{statusBadge(l.status)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{l.reviewedBy?.name ?? '—'}{l.reviewComment ? ` · ${l.reviewComment}` : ''}</td>
                  </tr>
                ))}
                {!myLeaves.length && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground"><CalendarX className="h-8 w-8 mx-auto mb-2 opacity-40" />No leave applications yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={page}
            pageSize={pageSize}
            total={total}
            baseUrl="/leaves"
          />
        </CardContent>
      </Card>
    </div>
  )
}
