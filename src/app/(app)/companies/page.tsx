import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { getScopedCompanyIds } from '@/lib/api-auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AddCompanyButton, ToggleCompanyButton, DeleteCompanyButton } from './actions'
import { fmtDate } from '@/lib/constants'
import { Building2, Users, CalendarCheck, GraduationCap, ArrowRight } from 'lucide-react'

export default async function CompaniesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')

  const isSuperAdmin = session.user.role === 'SUPER_ADMIN'
  const scopedIds = await getScopedCompanyIds({
    role: session.user.role,
    userId: session.user.id,
    employeeId: session.user.employeeId,
  })

  if (!isSuperAdmin && (!scopedIds || scopedIds.length === 0)) {
    redirect('/dashboard')
  }

  const where = scopedIds ? { id: { in: scopedIds } } : {}
  const companies = await db.company.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { assignments: true, attendance: true } } },
  })

  const stats = await Promise.all(
    companies.map(async (c) => ({
      id: c.id,
      employees: await db.employeeCompanyAssignment.count({ where: { companyId: c.id } }),
      students: c.type === 'INSTITUTE' ? await db.student.count() : 0,
    }))
  )
  const statMap = Object.fromEntries(stats.map((s) => [s.id, s]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Group Companies</h1>
          <p className="text-sm text-muted-foreground">
            {isSuperAdmin ? `Super admin · ${companies.length} companies in the group` : 'Your assigned companies'}
          </p>
        </div>
        {isSuperAdmin && <AddCompanyButton />}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {companies.map((c) => (
          <Card key={c.id} className={c.isActive ? '' : 'opacity-60'}>
            <CardHeader className="pb-2 flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-teal-700" /> {c.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{c.code} · joined {fmtDate(c.createdAt)}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge className={c.type === 'INSTITUTE' ? 'bg-violet-100 text-violet-800 border-0 text-[10px]' : 'bg-teal-100 text-teal-800 border-0 text-[10px]'}>
                  {c.type === 'INSTITUTE' ? 'Training & Placement' : 'Company'}
                </Badge>
                {!c.isActive && <Badge variant="destructive" className="text-[10px]">DISABLED</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-muted/60 p-2 flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-semibold">{statMap[c.id]?.employees ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground">employees</div>
                  </div>
                </div>
                <div className="rounded-md bg-muted/60 p-2 flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-semibold">{c._count.attendance}</div>
                    <div className="text-[10px] text-muted-foreground">attendance logs</div>
                  </div>
                </div>
                {c.type === 'INSTITUTE' && (
                  <div className="rounded-md bg-muted/60 p-2 flex items-center gap-2 col-span-2">
                    <GraduationCap className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-semibold">{statMap[c.id]?.students ?? 0}</div>
                      <div className="text-[10px] text-muted-foreground">students</div>
                    </div>
                  </div>
                )}
              </div>
              {c.address && <p className="text-xs text-muted-foreground mt-2">📍 {c.address}</p>}
              <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t">
                <Button asChild size="sm" variant="outline" className="text-xs">
                  <Link href={`/companies/${c.id}`}>
                    Manage & Drill Down <ArrowRight className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
                {isSuperAdmin && (
                  <div className="flex items-center gap-1.5">
                    <ToggleCompanyButton id={c.id} isActive={c.isActive} />
                    <DeleteCompanyButton id={c.id} name={c.name} employeeCount={statMap[c.id]?.employees ?? 0} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
