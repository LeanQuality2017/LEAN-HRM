import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES, ATTENDANCE_STATUSES, ATTENDANCE_SOURCES, ATTENDANCE_STATUS } from '@/lib/constants'
import { validateBody, attendancePatchSchema } from '@/lib/validation'
import { parsePaginationParams } from '@/lib/pagination'

// POST /api/attendance - web check-in / check-out toggle for today
export async function POST() {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'])
    if (!auth.employeeId) throw new ApiError(400, 'Not an employee account')

    const now = new Date()
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    today.setHours(0, 0, 0, 0)

    const existing = await db.attendance.findUnique({
      where: { employeeId_date: { employeeId: auth.employeeId, date: today } },
    })

    if (!existing || !existing.checkIn) {
      const status = now.getHours() >= 10 ? ATTENDANCE_STATUS.LATE : ATTENDANCE_STATUS.PRESENT
      let companyId = existing?.companyId
      if (!companyId) {
        const primary = await db.employeeCompanyAssignment.findFirst({ where: { employeeId: auth.employeeId, isPrimary: true } })
        companyId = primary?.companyId
      }
      if (!companyId) throw new ApiError(400, 'No company assignment found')
      const rec = existing
        ? await db.attendance.update({ where: { id: existing.id }, data: { checkIn: now, status, source: 'WEB' } })
        : await db.attendance.create({ data: { employeeId: auth.employeeId, companyId, date: today, checkIn: now, status, source: 'WEB' } })
      return Response.json({ ok: true, action: 'CHECK_IN', attendance: rec })
    }

    if (!existing.checkOut) {
      const rec = await db.attendance.update({ where: { id: existing.id }, data: { checkOut: now } })
      return Response.json({ ok: true, action: 'CHECK_OUT', attendance: rec })
    }

    throw new ApiError(400, 'Already checked in and out for today')
  })
}

// GET /api/attendance - list (own records; HR roles see all with filters ?employeeId=&companyId=&date=)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const employeeId = url.searchParams.get('employeeId') || undefined
    const companyId = url.searchParams.get('companyId') || undefined
    const dateStr = url.searchParams.get('date')

    const scopedIds = await getScopedCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Record<string, unknown> = {}
    const isHr = HR_ROLES.includes(auth.role)
    if (isHr) {
      if (employeeId) where.employeeId = employeeId
      if (companyId) {
        where.companyId = companyId
      } else if (scopedIds) {
        where.companyId = { in: scopedIds }
      }
    } else {
      if (!auth.employeeId) return Response.json({ ok: true, data: [], page: 1, pageSize: 25, total: 0 })
      where.employeeId = auth.employeeId
      if (companyId) {
        where.companyId = companyId
      } else if (scopedIds) {
        where.companyId = { in: scopedIds }
      }
    }

    if (dateStr) {
      const d = new Date(dateStr)
      const next = new Date(d.getTime() + 86400000)
      where.date = { gte: d, lt: next }
    }

    const { page, pageSize, skip } = parsePaginationParams(url)

    const [total, data] = await Promise.all([
      db.attendance.count({ where }),
      db.attendance.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: pageSize,
        include: {
          employee: { include: { user: { select: { name: true } } } },
          company: { select: { name: true, code: true } },
        },
      }),
    ])

    return Response.json({ ok: true, data, page, pageSize, total })
  })
}

// PATCH /api/attendance?id= - manual correction (HR only)
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')

    const existing = await db.attendance.findUnique({ where: { id } })
    if (!existing) throw new ApiError(404, 'Attendance record not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(existing.companyId, scopedIds)

    const body = validateBody(attendancePatchSchema, await req.json())

    if (body.status !== undefined) {
      if (!ATTENDANCE_STATUSES.includes(body.status as (typeof ATTENDANCE_STATUSES)[number])) {
        throw new ApiError(400, `Invalid attendance status: ${body.status}`)
      }
    }

    if (body.source !== undefined) {
      if (!ATTENDANCE_SOURCES.includes(body.source as (typeof ATTENDANCE_SOURCES)[number])) {
        throw new ApiError(400, `Invalid attendance source: ${body.source}`)
      }
    }

    const rec = await db.attendance.update({
      where: { id },
      data: {
        status: body.status ?? undefined,
        checkIn: body.checkIn ? new Date(body.checkIn) : undefined,
        checkOut: body.checkOut ? new Date(body.checkOut) : undefined,
        source: body.source ?? undefined,
        note: body.note ?? undefined,
      },
    })
    return Response.json({ ok: true, data: rec })
  })
}
