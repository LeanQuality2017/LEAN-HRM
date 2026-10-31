import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { NewReviewButton, CompleteReviewButton, NewKpiButton, UpdateKpiButton } from './actions'
import { fmtDate } from '@/lib/constants'
import { Target } from 'lucide-react'

export default async function PerformancePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')
  const role = session.user.role
  const employeeId = session.user.employeeId
  const isManager = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER'].includes(role)

  const NO_MATCH = { id: '__none__' } // safe empty filter for roles without employee record
  const reviewWhere = isManager
    ? role === 'MANAGER' && employeeId
      ? { employee: { managerId: employeeId } }
      : {}
    : employeeId
      ? { employeeId }
      : NO_MATCH
  const kpiWhere = isManager
    ? role === 'MANAGER' && employeeId
      ? { employee: { managerId: employeeId } }
      : {}
    : employeeId
      ? { employeeId }
      : NO_MATCH

  const [reviews, kpis, employees] = await Promise.all([
    db.performanceReview.findMany({
      where: reviewWhere, orderBy: { createdAt: 'desc' }, take: 100,
      include: { employee: { select: { employeeCode: true, user: { select: { name: true } } } }, reviewer: { select: { name: true } } },
    }),
    db.kPI.findMany({
      where: kpiWhere, orderBy: { period: 'desc' }, take: 100,
      include: { employee: { select: { employeeCode: true, user: { select: { name: true } } } } },
    }),
    isManager
      ? db.employee.findMany({
          where: role === 'MANAGER' && employeeId ? { managerId: employeeId } : { status: 'ACTIVE' },
          select: { id: true, employeeCode: true, user: { select: { name: true } } },
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
