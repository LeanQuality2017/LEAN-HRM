import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { STAFF_ROLES, MANAGEMENT_ROLES, PAYROLL_STATUS, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, regularisationSubmitSchema } from '@/lib/validation'
import { resolveAttendanceCompanyId } from '@/lib/attendance'

// GET /api/attendance/regularisation - list regularisation requests
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(STAFF_ROLES)

    // Anchor role gate (DP-18 verbatim pattern)
    if (!STAFF_ROLES.includes(auth.role)) {
      throw new ApiError(403, 'Forbidden: insufficient permissions')
    }

    const url = new URL(req.url)
    const companyId = url.searchParams.get('companyId') || undefined
    const status = url.searchParams.get('status') || undefined
    const employeeId = url.searchParams.get('employeeId') || undefined

    const scopedIds = await getScopedCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Prisma.AttendanceRegularisationWhereInput = {}

    // Non-managers see only their own requests
    const isManagerOrAbove = MANAGEMENT_ROLES.includes(auth.role)
    if (!isManagerOrAbove) {
      if (!auth.employeeId) throw new ApiError(400, 'Not an employee account')
      where.employeeId = auth.employeeId
    } else {
      if (employeeId) where.employeeId = employeeId
      if (companyId) {
        where.companyId = companyId
      } else if (scopedIds !== null) {
        where.companyId = { in: scopedIds }
      }
    }

    if (status) where.status = status

    const data = await db.attendanceRegularisation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            user: { select: { name: true, email: true } },
          },
        },
        reviewer: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    return Response.json({ ok: true, data })
  })
}

// POST /api/attendance/regularisation - employee submit missed-punch regularisation
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(STAFF_ROLES)

    // Anchor role gate (DP-18 verbatim pattern)
    if (!STAFF_ROLES.includes(auth.role)) {
      throw new ApiError(403, 'Forbidden: insufficient permissions')
    }

    if (!auth.employeeId) {
      throw new ApiError(400, 'Not an employee account')
    }

    const body = validateBody(regularisationSubmitSchema, await req.json())

    // Resolve target company ID for employee
    let targetCompanyId: string
    if (body.companyId) {
      const assignment = await db.employeeCompanyAssignment.findFirst({
        where: { employeeId: auth.employeeId, companyId: body.companyId },
      })
      if (!assignment) {
        throw new ApiError(403, 'Employee is not assigned to this company')
      }
      targetCompanyId = body.companyId
    } else {
      try {
        targetCompanyId = await resolveAttendanceCompanyId(auth.employeeId)
      } catch (err) {
        console.error('[attendance-scope]', err)
        throw new ApiError(400, 'No company assignment found')
      }
    }

    // Parse target work date
    const dateStr = (body.workDate || body.date)!.split('T')[0]
    const targetDate = new Date(`${dateStr}T00:00:00.000Z`)
    if (isNaN(targetDate.getTime())) {
      throw new ApiError(400, 'Invalid date format')
    }

    // -------------------------------------------------------------
    // GUARD 1: OD-A1 (Date Window Enforcement)
    // -------------------------------------------------------------
    const now = new Date()
    const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0]
    const today = new Date(`${todayStr}T00:00:00.000Z`)

    if (targetDate > today) {
      throw new ApiError(400, 'Cannot regularise attendance for future dates')
    }

    const payRule = await db.companyPayRule.findUnique({
      where: { companyId: targetCompanyId },
    })
    // OD-A1 (Owner ruling 10B): FIXED 30 days for ALL companies
    const windowDays =
      payRule?.regularisationWindowDays && payRule.regularisationWindowDays !== 7
        ? payRule.regularisationWindowDays
        : 30
    const earliestAllowed = new Date(today.getTime() - windowDays * 86400000)

    if (targetDate < earliestAllowed) {
      throw new ApiError(
        400,
        `Regularisation window expired: requests must be within ${windowDays} days`
      )
    }

    // -------------------------------------------------------------
    // GUARD 2: OD-A3 (Payroll-Lock Rejection)
    // -------------------------------------------------------------
    const month = targetDate.getUTCMonth() + 1
    const year = targetDate.getUTCFullYear()

    const lockedPayroll = await db.payroll.findFirst({
      where: {
        employeeId: auth.employeeId,
        month,
        year,
        status: { in: [PAYROLL_STATUS.LOCKED, PAYROLL_STATUS.PROCESSED, PAYROLL_STATUS.PAID] },
      },
    })
    if (lockedPayroll) {
      throw new ApiError(
        400,
        `Cannot regularise attendance: payroll for ${month}/${year} is locked or already processed`
      )
    }

    // -------------------------------------------------------------
    // GUARD 3: OD-A5 (One Request Per Employee Per Day)
    // -------------------------------------------------------------
    const existing = await db.attendanceRegularisation.findFirst({
      where: {
        employeeId: auth.employeeId,
        date: targetDate,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    })
    if (existing) {
      throw new ApiError(409, 'A regularisation request already exists for this date')
    }

    // Parse intended checkIn and checkOut
    const rawCheckIn = body.intendedCheckIn || body.requestedCheckIn
    const rawCheckOut = body.intendedCheckOut || body.requestedCheckOut

    const checkInDate = rawCheckIn ? new Date(rawCheckIn) : null
    const checkOutDate = rawCheckOut ? new Date(rawCheckOut) : null

    const reqRecord = await db.$transaction(async (tx) => {
      const created = await tx.attendanceRegularisation.create({
        data: {
          employeeId: auth.employeeId!,
          companyId: targetCompanyId,
          date: targetDate,
          requestedStatus: body.requestedStatus ?? 'PRESENT',
          requestedCheckIn: checkInDate,
          requestedCheckOut: checkOutDate,
          reason: body.reason,
          status: 'PENDING',
        },
      })

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.REGULARISATION_SUBMIT, 'AttendanceRegularisation', created.id, {
        employeeId: auth.employeeId,
        companyId: targetCompanyId,
        workDate: dateStr,
        reason: body.reason,
      })

      return created
    })

    return Response.json({ ok: true, data: reqRecord }, { status: 201 })
  })
}

