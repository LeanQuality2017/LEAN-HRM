import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NewAssessmentButton, EnterResultsButton } from './actions'
import { fmtDate } from '@/lib/constants'
import { ClipboardCheck } from 'lucide-react'

export default async function AssessmentsPage() {
  const [assessments, batches] = await Promise.all([
    db.assessment.findMany({
      orderBy: { date: 'desc' }, take: 100,
      include: {
        batch: { select: { name: true, course: { select: { name: true, code: true } } } },
        results: { include: { student: { select: { name: true, code: true } } } },
      },
    }),
    db.batch.findMany({ include: { course: { select: { name: true } } }, orderBy: { startDate: 'desc' } }),
  ])

  // enrolled students per batch for results entry
  const batchStudents = await db.studentEnrollment.findMany({
    include: { student: { select: { id: true, name: true, code: true } } },
  })
  const studentsByBatch = new Map<string, { id: string; name: string; code: string }[]>()
  for (const en of batchStudents) {
    const list = studentsByBatch.get(en.batchId) ?? []
    list.push(en.student)
    studentsByBatch.set(en.batchId, list)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Assessments</h1>
          <p className="text-sm text-muted-foreground">{assessments.length} assessments across all batches</p>
        </div>
        <NewAssessmentButton batches={batches.map((b) => ({ id: b.id, name: `${b.name} (${b.course.name})` }))} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {assessments.map((a) => {
          const avg = a.results.length ? Math.round(a.results.reduce((s, r) => s + r.score, 0) / a.results.length) : null
          return (
            <Card key={a.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="font-semibold text-sm">{a.title}</div>
                    <p className="text-xs text-muted-foreground mt-0.5">{a.batch.course.code} · {a.batch.name} · {fmtDate(a.date)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{a.results.length} graded</Badge>
                    {avg !== null && <Badge className="bg-teal-100 text-teal-800 border-0 text-[10px]">avg {avg}/{a.maxScore}</Badge>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.results.slice(0, 8).map((r) => (
                    <span key={r.id} className="text-[11px] rounded-full border px-2 py-0.5">
                      {r.student.name.split(' ')[0]}: <b>{r.score}</b>
                    </span>
                  ))}
                  {a.results.length > 8 && <span className="text-[11px] text-muted-foreground self-center">+{a.results.length - 8} more</span>}
                </div>
                <div className="mt-3">
                  <EnterResultsButton assessment={{ id: a.id, title: a.title, maxScore: a.maxScore }} students={studentsByBatch.get(a.batchId) ?? []} />
                </div>
              </CardContent>
            </Card>
          )
        })}
        {!assessments.length && (
          <div className="p-10 text-center text-muted-foreground md:col-span-2"><ClipboardCheck className="h-8 w-8 mx-auto mb-2 opacity-40" />No assessments yet.</div>
        )}
      </div>
    </div>
  )
}
