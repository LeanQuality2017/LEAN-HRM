import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { SubmitReportButton } from './submit-button'
import { ReviewReportButton } from './review-button'
import { fmtDate } from '@/lib/constants'
import { FileText } from 'lucide-react'
import { PaginationControls } from '@/components/pagination-controls'

export default async function WorkReportsPage({ searchParams }: { searchParams: Promise<{ scope?: string; companyId?: string; page?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')
  const role = session.user.role
  const employeeId = session.user.employeeId
  const sp = await searchParams
  const canReview = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER'].includes(role)
  const scope = sp.scope ?? (canReview ? 'team' : 'mine')
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = {}
  if (scope === 'mine') {
    if (employeeId) where.employeeId = employeeId
  } else {
    if (role === 'MANAGER' && employeeId) where.employee = { managerId: employeeId }
    if (sp.companyId) where.companyId = sp.companyId
  }

  const [total, unreviewed, reports] = await Promise.all([
    db.dailyWorkReport.count({ where }),
    db.dailyWorkReport.count({ where: { ...where, status: 'SUBMITTED' } }),
    db.dailyWorkReport.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: pageSize,
      include: {
        employee: { select: { employeeCode: true, user: { select: { name: true } } } },
        company: { select: { code: true } },
        comments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } },
      },
    }),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Work Reports</h1>
          <p className="text-sm text-muted-foreground">
            {scope === 'team' ? `${total} reports · ${unreviewed} awaiting review` : `Your daily EOD submissions (${total} total)`}
          </p>
        </div>
        <div className="flex gap-2">
          {canReview && (
            <>
              <Button asChild variant={scope === 'mine' ? 'outline' : 'default'} size="sm"><Link href="?scope=team">Team Reports</Link></Button>
              {employeeId && <Button asChild variant={scope === 'mine' ? 'default' : 'outline'} size="sm"><Link href="?scope=mine">My Reports</Link></Button>}
            </>
          )}
          {employeeId && <SubmitReportButton />}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y max-h-[72vh] overflow-y-auto">
            {reports.map((r) => (
              <div key={r.id} className="p-3.5 hover:bg-muted/30">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {scope === 'team' && <span className="font-semibold text-sm">{r.employee.user.name}</span>}
                      {scope === 'team' && <Badge variant="outline" className="text-[10px]">{r.company.code}</Badge>}
                      <span className="text-sm font-medium">{fmtDate(r.date)}</span>
                      <span className="text-xs text-muted-foreground">· {r.hoursWorked}h</span>
                      <Badge variant={r.status === 'REVIEWED' ? 'default' : 'secondary'} className={r.status === 'REVIEWED' ? 'bg-teal-700 text-[10px]' : 'bg-amber-100 text-amber-800 text-[10px] border-0'}>
                        {r.status}
                      </Badge>
                    </div>
                    <p className="text-sm mt-1.5 whitespace-pre-line">{r.tasks}</p>
                    {r.blockers && <p className="text-xs text-red-600 mt-1">⚠ Blocker: {r.blockers}</p>}
                    {r.comments.map((c) => (
                      <p key={c.id} className="text-xs text-teal-800 mt-1.5 bg-teal-50 rounded px-2 py-1">💬 <span className="font-medium">{c.user.name}</span>: {c.comment}</p>
                    ))}
                  </div>
                  {canReview && scope === 'team' && (
                    <div className="shrink-0">
                      <ReviewReportButton id={r.id} existing={r.comments[r.comments.length - 1]?.comment} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!reports.length && (
              <div className="p-10 text-center text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No reports found.
              </div>
            )}
          </div>
          <PaginationControls
            page={page}
            pageSize={pageSize}
            total={total}
            baseUrl="/work-reports"
            searchParams={{ scope, companyId: sp.companyId }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
