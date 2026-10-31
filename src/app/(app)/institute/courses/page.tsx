import { db } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NewCourseButton, NewBatchButton, BatchStatusSelect } from './actions'
import { fmtDate, fmtMoney } from '@/lib/constants'
import { BookOpen } from 'lucide-react'

export default async function CoursesPage() {
  const [courses, batches] = await Promise.all([
    db.course.findMany({ orderBy: { name: 'asc' } }),
    db.batch.findMany({
      orderBy: { startDate: 'desc' },
      include: { course: { select: { name: true, code: true } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
    }),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Courses & Batches</h1>
          <p className="text-sm text-muted-foreground">{courses.length} courses · {batches.length} batches</p>
        </div>
        <div className="flex gap-2">
          <NewBatchButton courses={courses.map((c) => ({ id: c.id, name: `${c.code} · ${c.name}` }))} />
          <NewCourseButton />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {courses.map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{c.name}</CardTitle>
              <p className="text-xs text-muted-foreground">{c.code} · {c.durationWeeks} weeks · <span className="font-semibold text-foreground">{fmtMoney(Number(c.fee))}</span></p>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground line-clamp-2">{c.description ?? '—'}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">All Batches</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                <tr>
                  <th className="p-3 font-medium">Batch</th>
                  <th className="p-3 font-medium">Course</th>
                  <th className="p-3 font-medium">Dates</th>
                  <th className="p-3 font-medium">Enrolled / Capacity</th>
                  <th className="p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t hover:bg-muted/40">
                    <td className="p-3 font-medium">{b.name}</td>
                    <td className="p-3"><Badge variant="outline" className="text-[10px]">{b.course.code}</Badge> {b.course.name}</td>
                    <td className="p-3 whitespace-nowrap text-xs">{fmtDate(b.startDate)} → {b.endDate ? fmtDate(b.endDate) : '—'}</td>
                    <td className="p-3">{b._count.enrollments} / {b.capacity}</td>
                    <td className="p-3"><BatchStatusSelect id={b.id} status={b.status} /></td>
                  </tr>
                ))}
                {!batches.length && (
                  <tr><td colSpan={5} className="p-10 text-center text-muted-foreground"><BookOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />No batches yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
