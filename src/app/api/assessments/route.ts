import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertInstituteInScope } from '@/lib/api-auth'
import { AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, assessmentCreateSchema, assessmentPatchSchema } from '@/lib/validation'

// POST /api/assessments - create assessment + optional results [{studentId, score, remarks}]
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'])
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const body = validateBody(assessmentCreateSchema, await req.json())
    const maxScore = Number(body.maxScore) || 100
    if (maxScore <= 0) throw new ApiError(400, 'maxScore must be greater than 0')

    const batch = await db.batch.findUnique({ where: { id: body.batchId } })
    if (!batch) throw new ApiError(404, 'Batch not found')

    if (Array.isArray(body.results) && body.results.length) {
      for (const r of body.results) {
        if (r.score != null) {
          const s = Number(r.score)
          if (isNaN(s) || s < 0 || s > maxScore) {
            throw new ApiError(400, `Score (${s}) must be between 0 and maxScore (${maxScore})`)
          }
        }
      }
    }

    const assessment = await db.$transaction(async (tx) => {
      const created = await tx.assessment.create({
        data: { batchId: body.batchId, title: body.title, date: new Date(body.date), maxScore },
      })
      if (Array.isArray(body.results) && body.results.length) {
        await tx.assessmentResult.createMany({
          data: body.results
            .filter((r) => r.studentId && r.score != null)
            .map((r) => ({
              assessmentId: created.id,
              studentId: r.studentId,
              score: Number(r.score),
              remarks: r.remarks ?? null,
            })),
        })
      }

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.ASSESSMENT_CREATE, 'Assessment', created.id, {
        batchId: body.batchId,
        title: body.title,
        maxScore,
      })

      return created
    })

    return Response.json({ ok: true, data: assessment }, { status: 201 })
  })
}

// PATCH /api/assessments?id= - save results [{studentId, score, remarks}] (upsert)
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'])
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(assessmentPatchSchema, await req.json())

    const assessment = await db.assessment.findUnique({ where: { id } })
    if (!assessment) throw new ApiError(404, 'Assessment not found')

    for (const r of body.results) {
      if (!r.studentId || r.score == null) continue
      const s = Number(r.score)
      if (isNaN(s) || s < 0 || s > assessment.maxScore) {
        throw new ApiError(400, `Score (${s}) must be between 0 and assessment maxScore (${assessment.maxScore})`)
      }
    }

    await db.$transaction(async (tx) => {
      for (const r of body.results) {
        if (!r.studentId || r.score == null) continue
        await tx.assessmentResult.upsert({
          where: { assessmentId_studentId: { assessmentId: id, studentId: r.studentId } },
          update: { score: Number(r.score), remarks: r.remarks ?? null },
          create: { assessmentId: id, studentId: r.studentId, score: Number(r.score), remarks: r.remarks ?? null },
        })
      }
    })

    return Response.json({ ok: true })
  })
}
