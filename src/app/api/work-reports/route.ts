import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { MANAGEMENT_ROLES, REPORT_STATUS } from '@/lib/constants'
import { validateBody, workReportCreateSchema } from '@/lib/validation'
import { parsePaginationParams } from '@/lib/pagination'
import { resolveAttendanceCompanyId } from '@/lib/attendance'

// POST /api/work-reports - submit daily EOD report
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'])
    if (!auth.employeeId) throw new ApiError(400, 'Not an employee account')
    const body = validateBody(workReportCreateSchema, await req.json())

    const date = new Date(body.date)
    date.setHours(0, 0, 0, 0)

    // Resolve primary/earliest company assignment
    let companyId: string
    try {
      companyId = await resolveAttendanceCompanyId(auth.employeeId)
    } catch {
      throw new ApiError(400, 'No company assignment found')
    }

    const existing = await db.dailyWorkReport.findUnique({
      where: {
        employeeId_companyId_date: {
          employeeId: auth.employeeId,
          companyId,
          date,
        },
      },
    })
    if (existing && existing.status === REPORT_STATUS.REVIEWED) {
      throw new ApiError(400, 'Reviewed work reports are immutable and cannot be re-submitted')
    }

    const report = await db.dailyWorkReport.upsert({
      where: {
        employeeId_companyId_date: {
          employeeId: auth.employeeId,
          companyId,
          date,
        },
      },
      update: { tasks: body.tasks, hoursWorked: body.hoursWorked ?? 8, blockers: body.blockers ?? null, status: REPORT_STATUS.SUBMITTED },
      create: {
        employeeId: auth.employeeId,
        companyId,
        date,
        tasks: body.tasks,
        hoursWorked: body.hoursWorked ?? 8,
        blockers: body.blockers ?? null,
      },
    })
    return Response.json({ ok: true, data: report }, { status: existing ? 200 : 201 })
  })
}

// GET /api/work-reports - mine (?scope=mine) or team/all (?scope=all&employeeId=&companyId=&status=)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const scope = url.searchParams.get('scope') || 'mine'
    const employeeId = url.searchParams.get('employeeId') || undefined
    const companyId = url.searchParams.get('companyId') || undefined
    const status = url.searchParams.get('status') || undefined

    const scopedIds = await getScopedCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Record<string, unknown> = {}
    if (scope === 'all') {
      if (!MANAGEMENT_ROLES.includes(auth.role)) throw new ApiError(403, 'Forbidden')
      if (employeeId) where.employeeId = employeeId
      if (companyId) {
        where.companyId = companyId
      } else if (scopedIds) {
        where.companyId = { in: scopedIds }
      }
      if (auth.role === 'MANAGER' && auth.employeeId) where.employee = { managerId: auth.employeeId }
    } else {
      if (!auth.employeeId) return Response.json({ ok: true, data: [], page: 1, pageSize: 25, total: 0 })
      where.employeeId = auth.employeeId
    }
    if (status) where.status = status

    const { page, pageSize, skip } = parsePaginationParams(url)

    const [total, data] = await Promise.all([
      db.dailyWorkReport.count({ where }),
      db.dailyWorkReport.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
        include: {
          employee: { select: { employeeCode: true, user: { select: { name: true } } } },
          company: { select: { code: true } },
          comments: { include: { user: { select: { name: true } } } },
        },
      }),
    ])

    return Response.json({ ok: true, data, page, pageSize, total })
  })
}
