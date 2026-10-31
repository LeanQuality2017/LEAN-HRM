import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AddStudentButton, EditStudentButton } from './actions'
import { fmtMoney, HR_ROLES } from '@/lib/constants'
import { Download, GraduationCap, Search } from 'lucide-react'

function statusBadge(s: string) {
  const map: Record<string, string> = {
    ENQUIRY: 'bg-amber-100 text-amber-800', ENROLLED: 'bg-teal-100 text-teal-800',
    IN_TRAINING: 'bg-violet-100 text-violet-800', TRAINED: 'bg-sky-100 text-sky-800',
    PLACED: 'bg-emerald-100 text-emerald-800', DROPPED: 'bg-gray-100 text-gray-600',
  }
  return <Badge className={`${map[s] ?? 'bg-gray-100'} text-[10px] border-0`}>{s.replaceAll('_', ' ')}</Badge>
}

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getServerSession(authOptions)
  const role = session?.user?.role
  const canExport = role && HR_ROLES.includes(role)
  const sp = await searchParams
  const q = sp.q?.toLowerCase() ?? ''

  const [students, batches] = await Promise.all([
    db.student.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {},
      orderBy: { createdAt: 'desc' }, take: 200,
      include: {
        enrollments: { include: { batch: { include: { course: { select: { name: true } } } } } },
        payments: { select: { amount: true } },
        placements: { select: { companyName: true, role: true } },
        user: { select: { email: true } },
      },
    }),
    db.batch.findMany({ include: { course: { select: { name: true } } }, orderBy: { startDate: 'desc' } }),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Students</h1>
          <p className="text-sm text-muted-foreground">{students.length} students · Training & Placement Institute</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <form className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input name="q" defaultValue={sp.q ?? ''} placeholder="Search name / code / email" className="pl-8 w-56" />
          </form>
          {canExport && (
            <Button asChild variant="outline" size="sm">
              <a href="/api/export/students" download>
                <Download className="h-4 w-4 mr-1" /> Export CSV
              </a>
            </Button>
          )}
          <AddStudentButton batches={batches.map((b) => ({ id: b.id, name: `${b.name} (${b.course.name})` }))} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                <tr>
                  <th className="p-3 font-medium">Student</th>
                  <th className="p-3 font-medium">Batch / Course</th>
                  <th className="p-3 font-medium">Qualification</th>
                  <th className="p-3 font-medium text-right">Fees Paid</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Placement</th>
                  <th className="p-3 font-medium">Portal</th>
                  <th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const paid = s.payments.reduce((sum, p) => sum + Number(p.amount), 0)
                  return (
                    <tr key={s.id} className="border-t hover:bg-muted/40">
                      <td className="p-3"><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.code} · {s.phone ?? s.email ?? '—'}</div></td>
                      <td className="p-3 text-xs">{s.enrollments.map((en) => <div key={en.id}>{en.batch.name} <span className="text-muted-foreground">({en.batch.course.name})</span></div>)}{!s.enrollments.length && '—'}</td>
                      <td className="p-3">{s.qualification ?? '—'}</td>
                      <td className="p-3 text-right font-medium">{fmtMoney(paid)}</td>
                      <td className="p-3">{statusBadge(s.status)}</td>
                      <td className="p-3 text-xs">{s.placements[0] ? `${s.placements[0].companyName}` : '—'}</td>
                      <td className="p-3">{s.user ? <Badge variant="outline" className="text-[10px]">Active</Badge> : <span className="text-xs text-muted-foreground">—</span>}</td>
                      <td className="p-3">
                        <EditStudentButton batches={batches.map((b) => ({ id: b.id, name: `${b.name} (${b.course.name})` }))} student={{
                          id: s.id, name: s.name, phone: s.phone ?? '', qualification: s.qualification ?? '',
                          status: s.status, batchId: s.enrollments[0]?.batchId ?? null,
                        }} />
                      </td>
                    </tr>
                  )
                })}
                {!students.length && (
                  <tr><td colSpan={8} className="p-10 text-center text-muted-foreground"><GraduationCap className="h-8 w-8 mx-auto mb-2 opacity-40" />No students found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
