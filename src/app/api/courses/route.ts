import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertInstituteInScope } from '@/lib/api-auth'
import { isInstituteEnabled } from '@/lib/feature-gates'
import { validateBody, courseCreateSchema, courseUpdateSchema } from '@/lib/validation'

// POST /api/courses - create course
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN'])
    if (!isInstituteEnabled()) {
      throw new ApiError(403, 'Institute module is disabled outside approved demo environments')
    }
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const body = validateBody(courseCreateSchema, await req.json())
    const exists = await db.course.findUnique({ where: { code: body.code.toUpperCase() } })
    if (exists) throw new ApiError(409, 'Course code already exists')
    const course = await db.course.create({
      data: { name: body.name, code: body.code.toUpperCase(), description: body.description ?? null, durationWeeks: Number(body.durationWeeks) || 8, fee: Number(body.fee) || 0 },
    })
    return Response.json({ ok: true, data: { ...course, fee: Number(course.fee) } })
  })
}

// PATCH /api/courses?id= - update course
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN'])
    if (!isInstituteEnabled()) {
      throw new ApiError(403, 'Institute module is disabled outside approved demo environments')
    }
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(courseUpdateSchema, await req.json())
    const course = await db.course.update({
      where: { id },
      data: { name: body.name ?? undefined, description: body.description ?? undefined, durationWeeks: body.durationWeeks != null ? Number(body.durationWeeks) : undefined, fee: body.fee != null ? Number(body.fee) : undefined },
    })
    return Response.json({ ok: true, data: { ...course, fee: Number(course.fee) } })
  })
}
