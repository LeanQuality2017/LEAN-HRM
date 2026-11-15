export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { requirePageAuth } from '@/lib/page-auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { NewReviewButton, CompleteReviewButton, NewKpiButton, UpdateKpiButton } from './actions'
import { fmtDate } from '@/lib/constants'
import { Target } from 'lucide-react'

export default async function PerformancePage() {
  const auth = await requirePageAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'])
  const { role, employeeId, administeredCompanyIds } = auth
  const isSuperAdmin = role === 'SUPER_ADMIN'
  const isCompanyAdminOrHr = role === 'COMPANY_ADMIN' || role === 'HR'
  const isManager = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER'].includes(role)

  let reviewWhere: Record<string, unknown> = {}
  let kpiWhere: Record<string, unknown> = {}
  let empWhere: Record<string, unknown> | null = null

  if (isSuperAdmin) {
    reviewWhere = {}
    kpiWhere = {}
    empWhere = { status: 'ACTIVE' }
  } else if (isCompanyAdminOrHr) {
    if (administeredCompanyIds && administeredCompanyIds.length > 0) {
      reviewWhere = {
        employee: {
          assignments: {
            some: {
              companyId: { in: administeredCompanyIds },
            },
          },
        },
      }
      kpiWhere = {
        employee: {
          assignments: {
            some: {
              companyId: { in: administeredCompanyIds },
            },
          },
        },
      }
      empWhere = {
        status: 'ACTIVE',
        assignments: {
          some: {
            companyId: { in: administeredCompanyIds },
          },
        },
      }
    } else {
      reviewWhere = { id: '__none__' }
      kpiWhere = { id: '__none__' }
      empWhere = { id: '__none__' }
    }
  } else if (role === 'MANAGER') {
    if (employeeId) {
      reviewWhere = { employee: { managerId: employeeId } }
      kpiWhere = { employee: { managerId: employeeId } }
      empWhere = { status: 'ACTIVE', managerId: employeeId }
    } else {
      reviewWhere = { id: '__none__' }
      kpiWhere = { id: '__none__' }
      empWhere = { id: '__none__' }
    }
  } else if (role === 'EMPLOYEE') {
    if (employeeId) {
      reviewWhere = { employeeId }
      kpiWhere = { employeeId }
      empWhere = null
    } else {
      reviewWhere = { id: '__none__' }
      kpiWhere = { id: '__none__' }
      empWhere = null
    }
  } else {
    reviewWhere = { id: '__none__' }
    kpiWhere = { id: '__none__' }
    empWhere = null
  }

  const [reviews, kpis, employees] = await Promise.all([
    db.performanceReview.findMany({
      where: reviewWhere,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        employee: { select: { employeeCode: true, user: { select: { name: true } } } },
        reviewer: { select: { name: true } },
      },
    }),
    db.kPI.findMany({
      where: kpiWhere,
      orderBy: { period: 'desc' },
      take: 100,
      include: { employee: { select: { employeeCode: true, user: { select: { name: true } } } } },
    }),
    empWhere
      ? db.employee.findMany({
          where: empWhere,
          select: { id: true, employeeCode: true, user: { select: { name: true } } },
          orderBy: { employeeCode: 'asc' },
        })
      : Promise.resolve([]),
  ])

  const empOptions = employees.map((e) => ({ id: e.id, name: e.user.name, code: e.employeeCode }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Performance</h1>
          <p className="text-sm text-muted-foreground">{isManager ? 'Reviews & KPIs for your team' : 'Your reviews & KPIs'}</p>
        </div>
        {isManager && empOptions.length > 0 && (
          <div className="flex gap-2">
            <NewKpiButton employees={empOptions} />
            <NewReviewButton employees={empOptions} />
          </div>
        )}
      </div>

      <Tabs defaultValue="reviews">
        <TabsList>
          <TabsTrigger value="reviews">Reviews ({reviews.length})</TabsTrigger>
          <TabsTrigger value="kpis">KPIs ({kpis.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="reviews" className="grid gap-3 md:grid-cols-2">
          {reviews.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-2 flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-sm">{r.employee.user.name} <span className="text-muted-foreground font-normal">· {r.period}</span></CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Reviewer: {r.reviewer.name} · {fmtDate(r.createdAt)}</p>
                </div>
                <Badge className={r.status === 'COMPLETED' ? 'bg-teal-700 text-[10px]' : 'bg-amber-100 text-amber-800 border-0 text-[10px]'}>{r.status}</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{r.goals}</p>
                {r.status === 'COMPLETED' && (
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant="outline">⭐ {r.rating}/5</Badge>
                    {r.comments && <p className="text-xs text-muted-foreground line-clamp-2">{r.comments}</p>}
                  </div>
                )}
                {isManager && r.status === 'PENDING' && <div className="mt-2"><CompleteReviewButton id={r.id} /></div>}
              </CardContent>
            </Card>
          ))}
          {!reviews.length && <div className="p-10 text-center text-muted-foreground md:col-span-2"><Target className="h-8 w-8 mx-auto mb-2 opacity-40" />No reviews yet.</div>}
        </TabsContent>

        <TabsContent value="kpis" className="grid gap-3 md:grid-cols-2">
          {kpis.map((k) => {
            const pct = k.target > 0 ? Math.min(100, Math.round((k.achieved / k.target) * 100)) : 0
            return (
              <Card key={k.id}>
                <CardHeader className="pb-2 flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-sm">{k.title}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{k.employee.user.name} · {k.period}</p>
                  </div>
                  {isManager && <UpdateKpiButton id={k.id} achieved={k.achieved} target={k.target} />}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="font-semibold">{k.achieved} / {k.target} {k.unit}</span>
                    <Badge variant="outline" className={pct >= 100 ? 'text-emerald-700' : pct >= 70 ? 'text-amber-700' : 'text-red-600'}>{pct}%</Badge>
                  </div>
                  <Progress value={pct} className="h-2" />
                </CardContent>
              </Card>
            )
          })}
          {!kpis.length && <div className="p-10 text-center text-muted-foreground md:col-span-2"><Target className="h-8 w-8 mx-auto mb-2 opacity-40" />No KPIs yet.</div>}
        </TabsContent>
      </Tabs>
    </div>
  )
}
