import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import {
  ROLES,
  STAFF_ROLES,
  MANAGEMENT_ROLES,
  ATTENDANCE_STATUS,
  PAYROLL_STATUS,
  AUDIT_ACTIONS,
} from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, regularisationReviewSchema } from '@/lib/validation'
import { resolveShiftForDate, classifyDay, type ResolvedShift } from '@/lib/attendance'

// GET /api/attendance/regularisation/[id] - get request details
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(STAFF_ROLES)

    // Anchor role gate (DP-18 verbatim pattern)
    if (!STAFF_ROLES.includes(auth.role)) {
      throw new ApiError(403, 'Forbidden: insufficient permissions')
    }

    const { id } = await params
    if (!id) throw new ApiError(400, 'id required')

    const reg = await db.attendanceRegularisation.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            managerId: true,
            user: { select: { name: true, email: true } },
          },
        },
        reviewer: {
          select: { id: true, name: true, email: true },
        },
      },
    })
    if (!reg) throw new ApiError(404, 'Regularisation request not found')

    const scopedIds = await getScopedCompanyIds(auth)
    const isManagerOrAbove = MANAGEMENT_ROLES.includes(auth.role)

    if (!isManagerOrAbove) {
      if (reg.employeeId !== auth.employeeId) {
        throw new ApiError(403, 'Forbidden: cannot view regularisation of another employee')
      }
    } else {
      assertCompanyInScope(reg.companyId, scopedIds)
    }

    return Response.json({ ok: true, data: reg })
  })
}

// PATCH /api/attendance/regularisation/[id] - manager approve or reject regularisation
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(MANAGEMENT_ROLES)

    // Anchor role gate (DP-18 verbatim pattern)
    if (!MANAGEMENT_ROLES.includes(auth.role)) {
      throw new ApiError(403, 'Forbidden: insufficient permissions')
    }

    const { id } = await params
    if (!id) throw new ApiError(400, 'id required')

    const body = validateBody(regularisationReviewSchema, await req.json())
    const isApprove = body.action === 'APPROVE' || body.status === 'APPROVED'

    const reg = await db.attendanceRegularisation.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            managerId: true,
            userId: true,
            user: { select: { id: true, role: true } },
          },
        },
      },
    })
    if (!reg) throw new ApiError(404, 'Regularisation request not found')

    if (reg.status !== 'PENDING') {
      throw new ApiError(400, `Request is already ${reg.status}`)
    }

    // Company scoping: manager/HR must never approve outside their company scope
    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(reg.companyId, scopedIds)

    // -------------------------------------------------------------
    // ESCALATION CHAIN & SELF-APPROVAL GATES (Owner ruling 9A-modified / M1 Fix)
    // -------------------------------------------------------------
    const isSelf =
      (auth.employeeId && auth.employeeId === reg.employeeId) ||
      (auth.userId && auth.userId === reg.employee.userId)

    if (isSelf) {
      // MANAGER can never approve himself under any branch.
      // HR's own request, and Manager/ADMIN's own request -> approvable by SUPER_ADMIN ONLY.
      if (auth.role !== ROLES.SUPER_ADMIN) {
        throw new ApiError(403, 'Forbidden: self-approval is not permitted (must be escalated)')
      }
    } else {
      const requesterRole = reg.employee.user?.role ?? ROLES.EMPLOYEE

      // Owner ruling 5A: TEAM_LEAD = STAFF-level, treated identical to EMPLOYEE in escalation chain
      if (requesterRole === ROLES.EMPLOYEE || (requesterRole as string) === 'TEAM_LEAD') {
        // Employee / Team Lead request -> approved by Manager (direct report check) or HR of that employee's company
        if (auth.role === ROLES.MANAGER) {
          if (!reg.employee.managerId || reg.employee.managerId !== auth.employeeId) {
            throw new ApiError(403, 'Forbidden: employee is not your direct report')
          }
        }
      } else if (requesterRole === ROLES.MANAGER) {
        // Manager's request -> approvable by HR of his company ONLY (or SUPER_ADMIN / ADMIN)
        if (auth.role === ROLES.MANAGER) {
          throw new ApiError(403, 'Forbidden: manager requests must be approved by HR or Super Admin')
        }
      } else if (requesterRole === ROLES.HR || requesterRole === ROLES.COMPANY_ADMIN) {
        // HR's own request, and Manager/ADMIN's own request -> approvable by SUPER_ADMIN ONLY
        if (auth.role !== ROLES.SUPER_ADMIN) {
          throw new ApiError(403, 'Forbidden: HR/Admin requests can only be approved by Super Admin')
        }
      }
    }

    const dateKey = reg.date.toISOString().split('T')[0]

    // Recalculation and status transition in atomic transaction
    const result = await db.$transaction(async (tx) => {
      if (isApprove) {
        // -------------------------------------------------------------
        // GUARD 2 (Re-check): OD-A3 (Payroll-Lock Rejection)
        // -------------------------------------------------------------
        const month = reg.date.getUTCMonth() + 1
        const year = reg.date.getUTCFullYear()

        const lockedPayroll = await tx.payroll.findFirst({
          where: {
            employeeId: reg.employeeId,
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

        // Fetch existing attendance to record beforeStatus
        const existingAtt = await tx.attendance.findUnique({
          where: {
            employeeId_companyId_date: {
              employeeId: reg.employeeId,
              companyId: reg.companyId,
              date: reg.date,
            },
          },
        })
        const beforeStatus = existingAtt?.status ?? ATTENDANCE_STATUS.ABSENT

        // Resolve applicable shift
        let shift: ResolvedShift
        try {
          const resolved = await resolveShiftForDate(reg.employeeId, reg.companyId, reg.date, tx)
          shift = resolved.shift
        } catch {
          throw new ApiError(400, 'Cannot regularise: no shift configured for employee/company')
        }

        // Query holiday and timezone
        const holiday = await tx.holiday.findUnique({
          where: {
            companyId_date: {
              companyId: reg.companyId,
              date: reg.date,
            },
          },
        })
        const isHoliday = !!holiday
        const isWeekoff = false

        const payRule = await tx.companyPayRule.findUnique({
          where: { companyId: reg.companyId },
        })
        const timeZone = payRule?.timezone || 'Asia/Kolkata'

        const checkInUtc = reg.requestedCheckIn ? reg.requestedCheckIn.toISOString() : null
        const checkOutUtc = reg.requestedCheckOut ? reg.requestedCheckOut.toISOString() : null

        // Recalculate attendance using pure classification engine
        const classification = classifyDay({
          dateKey,
          isHoliday,
          isWeekoff,
          punches: (checkInUtc || checkOutUtc) ? {
            checkInUtc,
            checkOutUtc,
            source: 'REGULARISATION',
          } : null,
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
          classifiedAt: new Date(),
        }

        // Upsert attendance record
        const attRecord = await tx.attendance.upsert({
          where: {
            employeeId_companyId_date: {
              employeeId: reg.employeeId,
              companyId: reg.companyId,
              date: reg.date,
            },
          },
          create: {
            employeeId: reg.employeeId,
            companyId: reg.companyId,
            date: reg.date,
            checkIn: reg.requestedCheckIn,
            checkOut: reg.requestedCheckOut,
            source: 'REGULARISATION',
            ...classificationData,
          },
          update: {
            checkIn: reg.requestedCheckIn ?? existingAtt?.checkIn,
            checkOut: reg.requestedCheckOut ?? existingAtt?.checkOut,
            source: 'REGULARISATION',
            ...classificationData,
          },
        })

        // Update regularisation request to APPROVED
        const updatedReg = await tx.attendanceRegularisation.update({
          where: { id },
          data: {
            status: 'APPROVED',
            reviewedById: auth.userId,
            reviewedAt: new Date(),
            reviewComment: body.reviewComment ?? null,
            attendanceId: attRecord.id,
          },
        })

        // Append AuditLog entry (per R20 spirit)
        await logAudit(tx, auth.userId, AUDIT_ACTIONS.REGULARISATION_APPROVE, 'AttendanceRegularisation', reg.id, {
          requestId: reg.id,
          approverId: auth.userId,
          employeeId: reg.employeeId,
          companyId: reg.companyId,
          beforeStatus,
          afterStatus: classification.status,
          workDate: dateKey,
        })

        return { request: updatedReg, attendance: attRecord }
      } else {
        // REJECT
        const updatedReg = await tx.attendanceRegularisation.update({
          where: { id },
          data: {
            status: 'REJECTED',
            reviewedById: auth.userId,
            reviewedAt: new Date(),
            reviewComment: body.reviewComment ?? null,
          },
        })

        // Append AuditLog entry
        await logAudit(tx, auth.userId, AUDIT_ACTIONS.REGULARISATION_REJECT, 'AttendanceRegularisation', reg.id, {
          requestId: reg.id,
          approverId: auth.userId,
          employeeId: reg.employeeId,
          companyId: reg.companyId,
          beforeStatus: 'PENDING',
          afterStatus: 'REJECTED',
          reviewComment: body.reviewComment,
          workDate: dateKey,
        })

        return { request: updatedReg }
      }
    })

    return Response.json({ ok: true, data: result })
  })
}

