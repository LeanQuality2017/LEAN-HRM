import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertInstituteInScope } from '@/lib/api-auth'
import { STUDENT_STATUS } from '@/lib/constants'
import { validateBody, enrollCreateSchema } from '@/lib/validation'

// POST /api/enroll - enroll a student into a batch
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'])
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const body = validateBody(enrollCreateSchema, await req.json())

    const batch = await db.batch.findUnique({ where: { id: body.batchId } })
    if (!batch) throw new ApiError(404, 'Batch not found')

    const student = await db.student.findUnique({ where: { id: body.studentId } })
    if (!student) throw new ApiError(404, 'Student not found')

    // Duplicate enrollment check
    const existing = await db.studentEnrollment.findUnique({
      where: { studentId_batchId: { studentId: body.studentId, batchId: body.batchId } },
    })
    if (existing) {
      throw new ApiError(400, 'Student is already enrolled in this batch')
    }

    // Active enrollments vs batch capacity
    const activeCount = await db.studentEnrollment.count({
      where: { batchId: body.batchId, status: 'ACTIVE' },
    })
    if (activeCount >= batch.capacity) {
      throw new ApiError(400, `Batch is full (capacity: ${batch.capacity})`)
    }

    await db.$transaction(async (tx) => {
      await tx.studentEnrollment.create({
        data: { studentId: body.studentId, batchId: body.batchId, status: 'ACTIVE' },
      })
      if (student.status === STUDENT_STATUS.ENQUIRY) {
        await tx.student.update({ where: { id: student.id }, data: { status: STUDENT_STATUS.ENROLLED } })
      }
    })

    return Response.json({ ok: true }, { status: 201 })
  })
}
