import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertInstituteInScope } from '@/lib/api-auth'
import { hashPassword } from '@/lib/password'
import { ROLES, STUDENT_STATUS } from '@/lib/constants'
import { validateBody, studentCreateSchema, studentUpdateSchema } from '@/lib/validation'

// GET /api/students - list institute students
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth()
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const data = await db.student.findMany({
      orderBy: { code: 'asc' },
      include: {
        enrollments: { include: { batch: { include: { course: true } } } },
        payments: true,
      },
    })
    return Response.json({ ok: true, data })
  })
}

// POST /api/students - register student (optionally with portal login)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth([ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN, ROLES.HR])
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const body = validateBody(studentCreateSchema, await req.json())

    const student = await db.$transaction(async (tx) => {
      let userId: string | null = null
      if (body.email && body.password) {
        const email = body.email.toLowerCase().trim()
        const exists = await tx.user.findUnique({ where: { email } })
        if (exists) throw new ApiError(409, 'A user with this email already exists')
        const u = await tx.user.create({
          data: {
            email,
            name: body.name,
            role: ROLES.STUDENT,
            phone: body.phone ?? null,
            passwordHash: hashPassword(body.password),
          },
        })
        userId = u.id
      }

      const count = await tx.student.count()
      const code = 'STU-' + String(count + 1).padStart(4, '0')
      const createdStudent = await tx.student.create({
        data: {
          userId,
          code,
          name: body.name,
          email: body.email ?? null,
          phone: body.phone ?? null,
          qualification: body.qualification ?? null,
          status: body.status ?? STUDENT_STATUS.ENQUIRY,
        },
      })

      if (body.batchId) {
        await tx.studentEnrollment.create({
          data: { studentId: createdStudent.id, batchId: body.batchId },
        })
        if (createdStudent.status === STUDENT_STATUS.ENQUIRY) {
          await tx.student.update({
            where: { id: createdStudent.id },
            data: { status: STUDENT_STATUS.ENROLLED },
          })
          createdStudent.status = STUDENT_STATUS.ENROLLED
        }
      }

      return createdStudent
    })

    return Response.json({ ok: true, data: student })
  })
}

// PATCH /api/students?id= - update student
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth([ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN, ROLES.HR])
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(studentUpdateSchema, await req.json())
    const student = await db.student.update({
      where: { id },
      data: { name: body.name ?? undefined, email: body.email ?? undefined, phone: body.phone ?? undefined, qualification: body.qualification ?? undefined, status: body.status ?? undefined },
    })
    return Response.json({ ok: true, data: student })
  })
}
