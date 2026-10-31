import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NewAnnouncementButton } from './new-button'
import { fmtDate } from '@/lib/constants'
import { Megaphone } from 'lucide-react'

export default async function AnnouncementsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')
  const role = session.user.role
  const employeeId = session.user.employeeId
  const canPost = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER'].includes(role)

  const companyScope = role === 'SUPER_ADMIN'
    ? null
    : employeeId
      ? (await db.employeeCompanyAssignment.findMany({ where: { employeeId }, select: { companyId: true } })).map((a) => a.companyId)
      : []

  const announcements = await db.announcement.findMany({
    where: role === 'SUPER_ADMIN' ? {} : companyScope ? { OR: [{ companyId: null }, { companyId: { in: companyScope } }] } : {},
    orderBy: { createdAt: 'desc' }, take: 50,
    include: { company: { select: { code: true } }, createdBy: { select: { name: true } } },
  })

  const companies = canPost
    ? role === 'SUPER_ADMIN'
      ? await db.company.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } })
      : await db.company.findMany({ where: { id: { in: companyScope?.length ? companyScope : [''] } }, select: { id: true, name: true } })
    : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Announcements</h1>
          <p className="text-sm text-muted-foreground">Company-wide and group-wide updates</p>
        </div>
        {canPost && companies.length > 0 && <NewAnnouncementButton companies={companies} />}
      </div>

      <div className="space-y-3 max-w-3xl">
        {announcements.map((a) => (
          <Card key={a.id}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Megaphone className="h-4 w-4 text-teal-700" />
                <span className="font-semibold text-sm">{a.title}</span>
                {a.company ? <Badge variant="outline" className="text-[10px]">{a.company.code}</Badge> : <Badge className="bg-teal-700 text-[10px]">ALL COMPANIES</Badge>}
                <span className="text-[10px] text-muted-foreground ml-auto">{a.createdBy.name} · {fmtDate(a.createdAt)}</span>
              </div>
              <p className="text-sm mt-2 whitespace-pre-line text-foreground/90">{a.content}</p>
            </CardContent>
          </Card>
        ))}
        {!announcements.length && (
          <div className="p-10 text-center text-muted-foreground"><Megaphone className="h-8 w-8 mx-auto mb-2 opacity-40" />No announcements yet.</div>
        )}
      </div>
    </div>
  )
}
