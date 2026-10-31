import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds } from '@/lib/api-auth'
import { MANAGEMENT_ROLES, REVIEW_STATUS } from '@/lib/constants'
import { validateBody, reviewsGetQuerySchema, reviewCreateSchema, reviewUpdateSchema } from '@/lib/validation'

// GET /api/reviews - list performance reviews (scoped)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const rawEmployeeId = url.searchParams.get('employeeId') || undefined
    const { employeeId } = reviewsGetQuerySchema.parse({ employeeId: rawEmployeeId })
    const scopedIds = await getScopedCompanyIds(auth)

    const where: Record<string, unknown> = {}

    if (!MANAGEMENT_ROLES.includes(auth.role)) {
      if (employeeId && employeeId !== auth.employeeId) {
        throw new ApiError(403, 'Forbidden: cannot view reviews for other employees')
      }
      where.employeeId = auth.employeeId || 'none'
    } else {
      if (auth.role === 'MANAGER') {
        const managerScope = [
          { employee: { managerId: auth.employeeId || 'none' } },
          { reviewerId: auth.userId },
          { employeeId: auth.employeeId || 'none' },
        ]
        if (employeeId) {
          where.employeeId = employeeId
          where.OR = managerScope
        } else {
          where.OR = managerScope
        }
      } else if (scopedIds) {
        where.employee = { assignments: { some: { companyId: { in: scopedIds } } } }
        if (employeeId) {
          where.employeeId = employeeId
        }
      } else {
        if (employeeId) {
          where.employeeId = employeeId
        }
      }
    }

    const data = await db.performanceReview.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: { select: { id: true, employeeCode: true, user: { select: { name: true, email: true } } } },
        reviewer: { select: { id: true, name: true, email: true } },
      },
    })
    return Response.json({ ok: true, data })
  })
}

// POST /api/reviews - create performance review assignment (MANAGER+)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(MANAGEMENT_ROLES)
    const body = validateBody(reviewCreateSchema, await req.json())

    // Block self-review
    if (auth.employeeId && body.employeeId === auth.employeeId) {
      throw new ApiError(400, 'Cannot assign performance review to yourself')
    }

    const emp = await db.employee.findUnique({
      where: { id: body.employeeId },
      include: { assignments: true },
    })
    if (!emp) throw new ApiError(404, 'Employee not found')

    const scopedIds = await getScopedCompanyIds(auth)
    if (scopedIds) {
      const inScope = emp.assignments.some((a) => scopedIds.includes(a.companyId))
      if (!inScope) throw new ApiError(403, 'Forbidden: employee out of scope')
    }

    if (auth.role === 'MANAGER' && auth.employeeId && emp.managerId !== auth.employeeId) {
      throw new ApiError(403, 'Forbidden: managers can only review direct reports')
    }

    const existing = await db.performanceReview.findFirst({
      where: { employeeId: body.employeeId, period: body.period },
    })
    if (existing) {
      throw new ApiError(409, `Review for ${body.period} already exists for this employee`)
    }

    const review = await db.performanceReview.create({
      data: { employeeId: body.employeeId, reviewerId: auth.userId, period: body.period, goals: body.goals },
    })
    const empUser = await db.employee.findUnique({ where: { id: body.employeeId }, select: { userId: true } })
    if (empUser) {
      await db.notification.create({
        data: { userId: empUser.userId, title: 'New performance review', message: `Review assigned for ${body.period}.`, link: '/performance' },
      })
    }
    return Response.json({ ok: true, data: review })
  })
}

// PATCH /api/reviews?id= - complete review with rating + comments
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(MANAGEMENT_ROLES)
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(reviewUpdateSchema, await req.json())

    const review = await db.performanceReview.findUnique({
      where: { id },
      include: { employee: { include: { assignments: true } } },
    })
    if (!review) throw new ApiError(404, 'Review not found')

    const scopedIds = await getScopedCompanyIds(auth)
    if (scopedIds) {
      const inScope = review.employee.assignments.some((a) => scopedIds.includes(a.companyId))
      if (!inScope) throw new ApiError(403, 'Forbidden: review out of scope')
    }

    if (auth.role === 'MANAGER' && review.reviewerId !== auth.userId) {
      throw new ApiError(403, 'Only the assigned reviewer can complete this review')
    }

    if (review.status === REVIEW_STATUS.COMPLETED) {
      throw new ApiError(400, 'Completed reviews are immutable')
    }

    const updated = await db.performanceReview.update({
      where: { id },
      data: {
        rating: body.rating != null ? Number(body.rating) : null,
        comments: body.comments ?? null,
        goals: body.goals ?? review.goals,
        status: REVIEW_STATUS.COMPLETED,
      },
    })
    const emp = await db.employee.findUnique({ where: { id: updated.employeeId }, select: { userId: true } })
    if (emp) {
      await db.notification.create({
        data: { userId: emp.userId, title: 'Review completed', message: `Your ${updated.period} review was completed.`, link: '/performance' },
      })
    }
    return Response.json({ ok: true, data: updated })
  })
}
