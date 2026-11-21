import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES, MANAGEMENT_ROLES, APP_STATUSES, APP_STATUS } from '@/lib/constants'
import { validateBody, applicationCreateSchema, applicationUpdateSchema } from '@/lib/validation'
import { parsePaginationParams } from '@/lib/pagination'

// GET /api/applications - list candidate applications with pagination
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(MANAGEMENT_ROLES)
    const url = new URL(req.url)
    const jobOpeningId = url.searchParams.get('jobOpeningId') || undefined
    const status = url.searchParams.get('status') || undefined
    const companyId = url.searchParams.get('companyId') || undefined

    const scopedIds = await getScopedCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Prisma.JobApplicationWhereInput = {}
    if (jobOpeningId) where.jobOpeningId = jobOpeningId
    if (status) where.status = status

    if (companyId) {
      where.jobOpening = { companyId }
    } else if (scopedIds) {
      where.jobOpening = { companyId: { in: scopedIds } }
    }

    const { page, pageSize, skip } = parsePaginationParams(url)

    const [total, data] = await Promise.all([
      db.jobApplication.count({ where }),
      db.jobApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          jobOpening: { select: { title: true, company: { select: { code: true } } } },
        },
      }),
    ])

    return Response.json({ ok: true, data, page, pageSize, total })
  })
}

// Valid forward transitions along NEW -> SCREENING -> INTERVIEW -> OFFER -> HIRED / REJECTED
const VALID_NEXT_APP_STATUS: Record<string, string[]> = {
  [APP_STATUS.NEW]: [APP_STATUS.SCREENING, APP_STATUS.REJECTED],
  [APP_STATUS.SCREENING]: [APP_STATUS.INTERVIEW, APP_STATUS.REJECTED],
  [APP_STATUS.INTERVIEW]: [APP_STATUS.OFFER, APP_STATUS.REJECTED],
  [APP_STATUS.OFFER]: [APP_STATUS.HIRED, APP_STATUS.REJECTED],
  [APP_STATUS.HIRED]: [],
  [APP_STATUS.REJECTED]: [],
}

// POST /api/applications - add candidate to a job (HR+)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const body = validateBody(applicationCreateSchema, await req.json())

    const job = await db.jobOpening.findUnique({ where: { id: body.jobOpeningId } })
    if (!job) throw new ApiError(404, 'Job opening not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(job.companyId, scopedIds)

    const app = await db.jobApplication.create({
      data: {
        jobOpeningId: body.jobOpeningId,
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        experience: Number(body.experience) || 0,
        resumeNote: body.resumeNote ?? null,
        status: APP_STATUS.NEW,
      },
    })
    return Response.json({ ok: true, data: app }, { status: 201 })
  })
}

// PATCH /api/applications?id= - move candidate through pipeline
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')

    const app = await db.jobApplication.findUnique({
      where: { id },
      include: { jobOpening: true },
    })
    if (!app) throw new ApiError(404, 'Application not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(app.jobOpening.companyId, scopedIds)

    const body = validateBody(applicationUpdateSchema, await req.json())

    // Validate status transition
    if (body.status !== undefined) {
      if (!APP_STATUSES.includes(body.status as (typeof APP_STATUSES)[number])) {
        throw new ApiError(400, `Invalid application status: ${body.status}`)
      }
      if (app.status !== body.status) {
        const allowedTransitions = VALID_NEXT_APP_STATUS[app.status] || []
        if (!allowedTransitions.includes(body.status)) {
          throw new ApiError(400, `Invalid status transition: cannot move from ${app.status} to ${body.status}`)
        }
      }
    }

    const updated = await db.jobApplication.update({
      where: { id },
      data: { status: body.status ?? undefined, notes: body.notes ?? undefined },
    })
    return Response.json({ ok: true, data: updated })
  })
}
