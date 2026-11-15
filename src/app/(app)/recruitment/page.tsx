export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { requirePageAuth } from '@/lib/page-auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NewJobButton, AddCandidateButton, CandidateStageSelect, JobStatusToggle } from './actions'
import { fmtDate } from '@/lib/constants'
import { Briefcase } from 'lucide-react'
import { PaginationControls } from '@/components/pagination-controls'

export default async function RecruitmentPage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  const auth = await requirePageAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'])
  const { role, administeredCompanyIds, employedCompanyIds } = auth
  const isSuperAdmin = role === 'SUPER_ADMIN'
  const isCompanyAdminOrHr = role === 'COMPANY_ADMIN' || role === 'HR'
  const sp = searchParams ? await searchParams : {}
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  let companies: { id: string; name: string }[] = []
  let jobWhere: Record<string, unknown> = {}
  let appWhere: Record<string, unknown> = {}

  if (isSuperAdmin) {
    companies = await db.company.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } })
    jobWhere = {}
    appWhere = {}
  } else if (isCompanyAdminOrHr) {
    if (administeredCompanyIds && administeredCompanyIds.length > 0) {
      companies = await db.company.findMany({
        where: { id: { in: administeredCompanyIds } },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      })
      jobWhere = { companyId: { in: administeredCompanyIds } }
      appWhere = { jobOpening: { companyId: { in: administeredCompanyIds } } }
    } else {
      companies = []
      jobWhere = { id: '__none__' }
      appWhere = { id: '__none__' }
    }
  } else {
    // MANAGER / EMPLOYEE: bounded by active employed companies
    if (employedCompanyIds && employedCompanyIds.length > 0) {
      companies = await db.company.findMany({
        where: { id: { in: employedCompanyIds } },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      })
      jobWhere = { companyId: { in: employedCompanyIds } }
      appWhere = { jobOpening: { companyId: { in: employedCompanyIds } } }
    } else {
      companies = []
      jobWhere = { id: '__none__' }
      appWhere = { id: '__none__' }
    }
  }

  const [jobs, totalApps, applications, stageGroups] = await Promise.all([
    db.jobOpening.findMany({
      where: jobWhere,
      orderBy: { createdAt: 'desc' },
      include: { company: { select: { code: true } }, _count: { select: { applications: true } } },
    }),
    db.jobApplication.count({ where: appWhere }),
    db.jobApplication.findMany({
      where: appWhere,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: { jobOpening: { select: { title: true, company: { select: { code: true } } } } },
    }),
    db.jobApplication.groupBy({
      by: ['status'],
      where: appWhere,
      _count: { _all: true },
    }),
  ])

  const jobOptions = jobs.filter((j) => j.status === 'OPEN').map((j) => ({ id: j.id, title: j.title, companyCode: j.company.code }))
  const stageMap = Object.fromEntries(stageGroups.map((g) => [g.status, g._count._all]))
  const stageCount = (s: string) => stageMap[s] ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Recruitment</h1>
          <p className="text-sm text-muted-foreground">{jobs.length} openings · {totalApps} candidates in pipeline</p>
        </div>
        <div className="flex gap-2">
          <AddCandidateButton jobs={jobOptions} />
          <NewJobButton companies={companies} />
        </div>
      </div>

      <Tabs defaultValue="pipeline">
        <TabsList>
          <TabsTrigger value="pipeline">Candidates ({totalApps})</TabsTrigger>
          <TabsTrigger value="jobs">Job Openings ({jobs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
            {['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'].map((s) => (
              <div key={s} className="rounded-md border p-2 text-center">
                <div className="text-lg font-bold">{stageCount(s)}</div>
                <div className="text-[10px] text-muted-foreground">{s}</div>
              </div>
            ))}
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                    <tr>
                      <th className="p-3 font-medium">Candidate</th>
                      <th className="p-3 font-medium">Applied For</th>
                      <th className="p-3 font-medium">Exp</th>
                      <th className="p-3 font-medium">Summary</th>
                      <th className="p-3 font-medium">Applied On</th>
                      <th className="p-3 font-medium">Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((a) => (
                      <tr key={a.id} className="border-t hover:bg-muted/40">
                        <td className="p-3"><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.email}{a.phone ? ` · ${a.phone}` : ''}</div></td>
                        <td className="p-3"><Badge variant="outline" className="text-[10px]">{a.jobOpening.company.code}</Badge> {a.jobOpening.title}</td>
                        <td className="p-3">{a.experience}y</td>
                        <td className="p-3 max-w-[200px] truncate text-xs text-muted-foreground" title={a.resumeNote ?? ''}>{a.resumeNote ?? '—'}</td>
                        <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(a.createdAt)}</td>
                        <td className="p-3"><CandidateStageSelect id={a.id} status={a.status} /></td>
                      </tr>
                    ))}
                    {!applications.length && (
                      <tr><td colSpan={6} className="p-10 text-center text-muted-foreground"><Briefcase className="h-8 w-8 mx-auto mb-2 opacity-40" />No candidates yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                page={page}
                pageSize={pageSize}
                total={totalApps}
                baseUrl="/recruitment"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs">
          <div className="grid gap-3 md:grid-cols-2">
            {jobs.map((j) => (
              <Card key={j.id}>
                <CardHeader className="pb-2 flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-sm">{j.title}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{j.company.code} · {j.department ?? '—'} · {j.openings} position(s)</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge className={j.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800 border-0 text-[10px]' : 'bg-gray-100 text-gray-600 border-0 text-[10px]'}>{j.status}</Badge>
                    <span className="text-[10px] text-muted-foreground">{j._count.applications} applicant(s)</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground line-clamp-2">{j.description ?? 'No description'}</p>
                  <div className="mt-2"><JobStatusToggle id={j.id} status={j.status} /></div>
                </CardContent>
              </Card>
            ))}
            {!jobs.length && <div className="p-10 text-center text-muted-foreground col-span-2"><Briefcase className="h-8 w-8 mx-auto mb-2 opacity-40" />No job openings yet.</div>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
