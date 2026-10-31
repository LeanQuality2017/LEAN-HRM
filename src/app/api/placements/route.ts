import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertInstituteInScope } from '@/lib/api-auth'
import { validateBody, placementCreateSchema, placementUpdateSchema } from '@/lib/validation'

// POST /api/placements - record placement
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'])
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const body = validateBody(placementCreateSchema, await req.json())
    const placement = await db.placement.create({
      data: {
        studentId: body.studentId, companyName: body.companyName, role: body.role,
        salary: body.salary ? Number(body.salary) : null, placedAt: body.placedAt ? new Date(body.placedAt) : new Date(),
        status: body.status ?? 'PLACED',
      },
    })
    await db.student.update({ where: { id: body.studentId }, data: { status: 'PLACED' } })
    const student = await db.student.findUnique({ where: { id: body.studentId } })
    if (student?.userId) {
      await db.notification.create({ data: { userId: student.userId, title: '🎉 You are placed!', message: `${body.companyName}: ${body.role}`, link: '/profile' } })
    }
    return Response.json({ ok: true, data: { ...placement, salary: placement.salary != null ? Number(placement.salary) : null } })
  })
}

// PATCH /api/placements?id= - update status
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'])
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(placementUpdateSchema, await req.json())
    const placement = await db.placement.update({ where: { id }, data: { status: body.status ?? undefined } })
    return Response.json({ ok: true, data: { ...placement, salary: placement.salary != null ? Number(placement.salary) : null } })
  })
}
