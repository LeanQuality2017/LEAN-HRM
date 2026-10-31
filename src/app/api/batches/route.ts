import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertInstituteInScope } from '@/lib/api-auth'
import { validateBody, batchCreateSchema, batchUpdateSchema } from '@/lib/validation'

// POST /api/batches - create batch
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN'])
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const body = validateBody(batchCreateSchema, await req.json())
    const batch = await db.batch.create({
      data: {
        courseId: body.courseId, name: body.name,
        startDate: new Date(body.startDate), endDate: body.endDate ? new Date(body.endDate) : null,
        capacity: Number(body.capacity) || 30, status: body.status ?? 'UPCOMING',
      },
    })
    return Response.json({ ok: true, data: batch })
  })
}

// PATCH /api/batches?id= - update status / dates
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN'])
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(batchUpdateSchema, await req.json())
    const batch = await db.batch.update({
      where: { id },
      data: { name: body.name ?? undefined, startDate: body.startDate ? new Date(body.startDate) : undefined, endDate: body.endDate !== undefined ? (body.endDate ? new Date(body.endDate) : null) : undefined, capacity: body.capacity != null ? Number(body.capacity) : undefined, status: body.status ?? undefined },
    })
    return Response.json({ ok: true, data: batch })
  })
}
