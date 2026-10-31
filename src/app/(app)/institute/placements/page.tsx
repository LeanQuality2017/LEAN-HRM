import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/stat-card'
import { RecordPlacementButton } from './actions'
import { fmtDate, fmtMoney } from '@/lib/constants'
import { Handshake, TrendingUp, IndianRupee } from 'lucide-react'

export default async function PlacementsPage() {
  const [placements, students] = await Promise.all([
    db.placement.findMany({
      orderBy: { placedAt: 'desc' }, take: 200,
      include: { student: { select: { name: true, code: true, qualification: true } } },
    }),
    db.student.findMany({ where: { status: { in: ['TRAINED', 'IN_TRAINING', 'ENROLLED'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
  ])

  const total = placements.length
  const avgSalary = total ? Math.round(placements.reduce((s, p) => s + (p.salary ? Number(p.salary) : 0), 0) / total) : 0
  const placedCount = (await db.student.count({ where: { status: 'PLACED' } }))
  const allStudents = await db.student.count()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Placements</h1>
          <p className="text-sm text-muted-foreground">Placement cell track record</p>
        </div>
        <RecordPlacementButton students={students} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Placement Rate" value={allStudents ? `${Math.round((placedCount / allStudents) * 100)}%` : '—'} sub={`${placedCount} of ${allStudents} students`} icon={TrendingUp} tone="good" />
        <StatCard title="Total Placements" value={total} icon={Handshake} />
        <StatCard title="Avg CTC" value={fmtMoney(avgSalary)} icon={IndianRupee} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                <tr>
                  <th className="p-3 font-medium">Student</th>
                  <th className="p-3 font-medium">Company</th>
                  <th className="p-3 font-medium">Role</th>
                  <th className="p-3 font-medium text-right">CTC</th>
                  <th className="p-3 font-medium">Placed On</th>
                  <th className="p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {placements.map((p) => (
                  <tr key={p.id} className="border-t hover:bg-muted/40">
                    <td className="p-3"><div className="font-medium">{p.student.name}</div><div className="text-xs text-muted-foreground">{p.student.code} · {p.student.qualification ?? '—'}</div></td>
                    <td className="p-3 font-medium">{p.companyName}</td>
                    <td className="p-3">{p.role}</td>
                    <td className="p-3 text-right font-semibold">{p.salary ? fmtMoney(Number(p.salary)) : '—'}</td>
                    <td className="p-3 whitespace-nowrap text-xs">{fmtDate(p.placedAt)}</td>
                    <td className="p-3">
                      <Badge className={p.status === 'JOINED' ? 'bg-emerald-100 text-emerald-800 border-0 text-[10px]' : p.status === 'PLACED' ? 'bg-teal-100 text-teal-800 border-0 text-[10px]' : 'bg-gray-100 text-gray-600 border-0 text-[10px]'}>
                        {p.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {!placements.length && (
                  <tr><td colSpan={6} className="p-10 text-center text-muted-foreground"><Handshake className="h-8 w-8 mx-auto mb-2 opacity-40" />No placements recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
