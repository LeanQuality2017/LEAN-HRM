import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getAdministeredCompanyIds, assertInstituteInScope } from '@/lib/api-auth'
import { isInstituteEnabled } from '@/lib/feature-gates'
import { hashPassword } from '@/lib/password'
import { ROLES, STUDENT_STATUS } from '@/lib/constants'
import { validateBody, studentCreateSchema, studentUpdateSchema } from '@/lib/validation'

// GET /api/students - list institute students (admin sees all institute students; student sees own record only)
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth()
    if (!isInstituteEnabled()) {
      throw new ApiError(403, 'Institute module is disabled outside approved demo environments')
    }

    const where: Record<string, unknown> = {}

    if (auth.role === ROLES.STUDENT) {
      where.userId = auth.userId
    } else if (
      auth.role === ROLES.SUPER_ADMIN ||
      auth.role === ROLES.COMPANY_ADMIN ||
      auth.role === ROLES.HR
    ) {
      const administeredIds = await getAdministeredCompanyIds(auth)
      await assertInstituteInScope(administeredIds)
    } else {
      throw new ApiError(403, 'Forbidden: insufficient permissions')
    }

    const data = await db.student.findMany({
      where,
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
    if (!isInstituteEnabled()) {
      throw new ApiError(403, 'Institute module is disabled outside approved demo environments')
    }
    const administeredIds = await getAdministeredCompanyIds(auth)
    await assertInstituteInScope(administeredIds)

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
    const administeredIds = await getAdministeredCompanyIds(auth)
    await assertInstituteInScope(administeredIds)

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
