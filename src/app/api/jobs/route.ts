import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES } from '@/lib/constants'
import { validateBody, jobCreateSchema, jobUpdateSchema } from '@/lib/validation'

// GET /api/jobs - list job openings (?companyId=)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const companyId = url.searchParams.get('companyId')

    const scopedIds = await getScopedCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Record<string, unknown> = {}
    if (companyId) {
      where.companyId = companyId
    } else if (scopedIds) {
      where.companyId = { in: scopedIds }
    }

    const data = await db.jobOpening.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { name: true, code: true } },
        _count: { select: { applications: true } },
      },
    })
    return Response.json({ ok: true, data })
  })
}

// POST /api/jobs - create job opening (HR+)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const body = validateBody(jobCreateSchema, await req.json())

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(body.companyId, scopedIds)

    const job = await db.jobOpening.create({
      data: {
        companyId: body.companyId,
        title: body.title,
        department: body.department ?? null,
        description: body.description ?? null,
        openings: Number(body.openings) || 1,
      },
    })
    return Response.json({ ok: true, data: job })
  })
}

// PATCH /api/jobs?id= - update status/details
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')

    const existing = await db.jobOpening.findUnique({ where: { id } })
    if (!existing) throw new ApiError(404, 'Job opening not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(existing.companyId, scopedIds)

    const body = validateBody(jobUpdateSchema, await req.json())
    const job = await db.jobOpening.update({
      where: { id },
      data: {
        title: body.title ?? undefined,
        department: body.department ?? undefined,
        description: body.description ?? undefined,
        openings: body.openings != null ? Number(body.openings) : undefined,
        status: body.status ?? undefined,
      },
    })
    return Response.json({ ok: true, data: job })
  })
}
