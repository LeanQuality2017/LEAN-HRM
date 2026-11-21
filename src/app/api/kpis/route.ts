import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds } from '@/lib/api-auth'
import { MANAGEMENT_ROLES } from '@/lib/constants'
import { validateBody, kpiCreateSchema, kpiUpdateSchema } from '@/lib/validation'

// GET /api/kpis - list KPIs (scoped)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const employeeId = url.searchParams.get('employeeId')
    const scopedIds = await getScopedCompanyIds(auth)

    const where: Prisma.KPIWhereInput = {}
    if (auth.role === 'EMPLOYEE') {
      where.employeeId = auth.employeeId || 'none'
    } else if (employeeId) {
      const emp = await db.employee.findUnique({
        where: { id: employeeId },
        include: { assignments: true },
      })
      if (!emp) throw new ApiError(404, 'Employee not found')
      if (scopedIds) {
        const inScope = emp.assignments.some((a) => scopedIds.includes(a.companyId))
        if (!inScope) throw new ApiError(403, 'Forbidden: employee out of scope')
      }
      where.employeeId = employeeId
    } else if (scopedIds) {
      where.employee = { assignments: { some: { companyId: { in: scopedIds } } } }
    }

    const data = await db.kPI.findMany({
      where,
      orderBy: { period: 'desc' },
      include: {
        employee: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
      },
    })
    return Response.json({ ok: true, data })
  })
}

// POST /api/kpis - set KPI (MANAGER+)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(MANAGEMENT_ROLES)
    const body = validateBody(kpiCreateSchema, await req.json())

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
      throw new ApiError(403, 'Forbidden: managers can only set KPIs for direct reports')
    }

    const kpi = await db.kPI.create({
      data: {
        employeeId: body.employeeId,
        title: body.title,
        target: Number(body.target),
        achieved: Number(body.achieved) || 0,
        unit: body.unit ?? '%',
        period: body.period,
      },
    })
    return Response.json({ ok: true, data: kpi })
  })
}

// PATCH /api/kpis?id= - update achieved / target
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(MANAGEMENT_ROLES)
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(kpiUpdateSchema, await req.json())

    const kpi = await db.kPI.findUnique({
      where: { id },
      include: { employee: { include: { assignments: true } } },
    })
    if (!kpi) throw new ApiError(404, 'KPI not found')

    const scopedIds = await getScopedCompanyIds(auth)
    if (scopedIds) {
      const inScope = kpi.employee.assignments.some((a) => scopedIds.includes(a.companyId))
      if (!inScope) throw new ApiError(403, 'Forbidden: KPI out of scope')
    }

    if (auth.role === 'MANAGER' && auth.employeeId && kpi.employee.managerId !== auth.employeeId) {
      throw new ApiError(403, 'Forbidden: managers can only update KPIs for direct reports')
    }

    const updated = await db.kPI.update({
      where: { id },
      data: {
        achieved: body.achieved != null ? Number(body.achieved) : undefined,
        target: body.target != null ? Number(body.target) : undefined,
        title: body.title ?? undefined,
        period: body.period ?? undefined,
      },
    })
    return Response.json({ ok: true, data: updated })
  })
}
