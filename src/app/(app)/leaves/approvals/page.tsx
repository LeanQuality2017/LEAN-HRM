import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ReviewButtons } from './review-buttons'
import { fmtDate } from '@/lib/constants'
import { CalendarX } from 'lucide-react'
import { PaginationControls } from '@/components/pagination-controls'

export default async function LeaveApprovalsPage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')
  const role = session.user.role
  const employeeId = session.user.employeeId
  const sp = searchParams ? await searchParams : {}
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = { status: 'PENDING' }
  if (role === 'MANAGER' && employeeId) where.employee = { managerId: employeeId }

  const [total, requests] = await Promise.all([
    db.leaveRequest.count({ where }),
    db.leaveRequest.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip,
      take: pageSize,
      include: {
        employee: { select: { employeeCode: true, user: { select: { name: true } } } },
        leaveType: { select: { name: true } },
      },
    }),
  ])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Leave Approvals</h1>
        <p className="text-sm text-muted-foreground">
          {role === 'MANAGER' ? 'Pending requests from your direct reports' : 'All pending leave requests'}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                <tr>
                  <th className="p-3 font-medium">Employee</th>
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 font-medium">Dates</th>
                  <th className="p-3 font-medium">Days</th>
                  <th className="p-3 font-medium">Reason</th>
                  <th className="p-3 font-medium">Applied</th>
                  <th className="p-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((l) => (
                  <tr key={l.id} className="border-t hover:bg-muted/40">
                    <td className="p-3"><div className="font-medium">{l.employee.user.name}</div><div className="text-xs text-muted-foreground">{l.employee.employeeCode}</div></td>
                    <td className="p-3">{l.leaveType.name}</td>
                    <td className="p-3 whitespace-nowrap">{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
                    <td className="p-3"><Badge variant="outline">{l.days}</Badge></td>
                    <td className="p-3 max-w-[220px] truncate" title={l.reason}>{l.reason}</td>
                    <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(l.createdAt)}</td>
                    <td className="p-3"><ReviewButtons id={l.id} /></td>
                  </tr>
                ))}
                {!requests.length && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground"><CalendarX className="h-8 w-8 mx-auto mb-2 opacity-40" />No pending leave requests. All caught up! 🎉</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={page}
            pageSize={pageSize}
            total={total}
            baseUrl="/leaves/approvals"
          />
        </CardContent>
      </Card>
    </div>
  )
}
