import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES, ATTENDANCE_STATUSES, ATTENDANCE_SOURCES, ATTENDANCE_STATUS } from '@/lib/constants'
import { validateBody, attendancePatchSchema } from '@/lib/validation'
import { parsePaginationParams } from '@/lib/pagination'
import { resolveAttendanceCompanyId, resolveShiftForDate, classifyDay, zonedDateKey, type ResolvedShift } from '@/lib/attendance'

// POST /api/attendance - web check-in / check-out toggle for today
export async function POST() {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'])
    if (!auth.employeeId) throw new ApiError(400, 'Not an employee account')

    const now = new Date()
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    today.setHours(0, 0, 0, 0)

    // Resolve primary/earliest assignment for web check-in (employee self-punch)
    let companyId: string
    try {
      companyId = await resolveAttendanceCompanyId(auth.employeeId)
    } catch (err) {
      console.error('[attendance-scope]', err)
      throw new ApiError(400, 'No company assignment found')
    }

    // Resolve shift for employee on today's date
    let shift: ResolvedShift
    try {
      const resolved = await resolveShiftForDate(auth.employeeId, companyId, today, db)
      shift = resolved.shift
    } catch (err) {
      console.error('[attendance-shift]', err)
      throw new ApiError(400, err instanceof Error ? err.message : 'No shift configured')
    }

    // Query holiday for company and date
    const holiday = await db.holiday.findUnique({
      where: {
        companyId_date: {
          companyId,
          date: today,
        },
      },
    })
    const isHoliday = !!holiday

    // Compute isWeekoff from shift/company rule (no weekoff model exists yet -> false per spec)
    const isWeekoff = false

    // Resolve company timezone
    const payRule = await db.companyPayRule.findUnique({ where: { companyId } })
    const timeZone = payRule?.timezone || 'Asia/Kolkata'
    const dateKey = zonedDateKey(now.toISOString(), timeZone)

    const existing = await db.attendance.findUnique({
      where: {
        employeeId_companyId_date: {
          employeeId: auth.employeeId,
          companyId,
          date: today,
        },
      },
    })

    if (!existing || !existing.checkIn) {
      const classification = classifyDay({
        dateKey,
        isHoliday,
        isWeekoff,
        punches: {
          checkInUtc: now.toISOString(),
          checkOutUtc: null,
          source: 'WEB',
        },
        shift,
        timeZone,
      })

      const classificationData = {
        status: classification.status,
        lateMinutes: classification.lateMinutes.toNumber(),
        earlyExitMinutes: classification.earlyExitMinutes.toNumber(),
        otMinutes: Math.round(classification.otHours.mul(60).toNumber()),
        isLop: classification.isLop,
        shiftId: shift.id,
        classifiedAt: now,
      }

      const rec = existing
        ? await db.attendance.update({
            where: {
              employeeId_companyId_date: {
                employeeId: auth.employeeId,
                companyId,
                date: today,
              },
            },
            data: {
              checkIn: now,
              source: 'WEB',
              ...classificationData,
            },
          })
        : await db.attendance.create({
            data: {
              employeeId: auth.employeeId,
              companyId,
              date: today,
              checkIn: now,
              source: 'WEB',
              ...classificationData,
            },
          })
      return Response.json({ ok: true, action: 'CHECK_IN', attendance: rec })
    }

    if (!existing.checkOut) {
      const checkInUtc = existing.checkIn ? existing.checkIn.toISOString() : now.toISOString()
      const checkOutUtc = now.toISOString()

      const classification = classifyDay({
        dateKey,
        isHoliday,
        isWeekoff,
        punches: {
          checkInUtc,
          checkOutUtc,
          source: existing.source ?? 'WEB',
        },
        shift,
        timeZone,
      })

      const rec = await db.attendance.update({
        where: {
          employeeId_companyId_date: {
            employeeId: auth.employeeId,
            companyId,
            date: today,
          },
        },
        data: {
          checkOut: now,
          status: classification.status,
          lateMinutes: classification.lateMinutes.toNumber(),
          earlyExitMinutes: classification.earlyExitMinutes.toNumber(),
          otMinutes: Math.round(classification.otHours.mul(60).toNumber()),
          isLop: classification.isLop,
          shiftId: shift.id,
          classifiedAt: now,
        },
      })
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
