import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds } from '@/lib/api-auth'
import { MANAGEMENT_ROLES, LEAVE_STATUS, ATTENDANCE_STATUS, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, leavePatchSchema } from '@/lib/validation'
import { sendLeaveStatusEmail } from '@/lib/mail'

// PATCH /api/leaves/:id - approve/reject (MANAGER of own reports, HR+)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(MANAGEMENT_ROLES)
    const { id } = await params
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(leavePatchSchema, await req.json())
    const status = body.status

    const leave = await db.leaveRequest.findUnique({
      where: { id },
      include: {
        employee: {
          include: {
            assignments: true,
            user: { select: { name: true, email: true } },
          },
        },
        leaveType: { select: { name: true } },
      },
    })
    if (!leave) throw new ApiError(404, 'Leave not found')

    // Terminal state check: status changes only from PENDING
    if (leave.status !== LEAVE_STATUS.PENDING) {
      throw new ApiError(400, 'Leave requests in terminal status (APPROVED/REJECTED/CANCELLED) cannot be modified')
    }

    // Employee cannot review/approve own leave request
    if (leave.employee.userId === auth.userId) {
      throw new ApiError(403, 'Employees cannot approve their own leave request')
    }

    const scopedIds = await getScopedCompanyIds(auth)
    if (scopedIds) {
      const inScope = leave.employee.assignments.some((a) => scopedIds.includes(a.companyId))
      if (!inScope) {
        throw new ApiError(403, 'Forbidden: leave request out of scope')
      }
    }

    // Managers can only act on their direct reports
    if (auth.role === 'MANAGER' && leave.employee.managerId !== auth.employeeId) {
      throw new ApiError(403, 'You can only review leaves of your direct reports')
    }

    const updated = await db.$transaction(async (tx) => {
      const rec = await tx.leaveRequest.update({
        where: { id },
        data: { status, reviewComment: body.comment ?? null, reviewedById: auth.userId, reviewedAt: new Date() },
      })

      // On approval, mark attendance as LEAVE for the date range (best-effort)
      if (status === LEAVE_STATUS.APPROVED) {
        const start = new Date(leave.startDate), end = new Date(leave.endDate)
        for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
          const day = new Date(d)
          day.setHours(0, 0, 0, 0)
          const existing = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: leave.employeeId, date: day } } })
          if (existing) {
            await tx.attendance.update({ where: { id: existing.id }, data: { status: ATTENDANCE_STATUS.LEAVE, note: 'Approved leave' } })
          } else {
            const primary = await tx.employeeCompanyAssignment.findFirst({ where: { employeeId: leave.employeeId, isPrimary: true } })
            if (primary) {
              await tx.attendance.create({ data: { employeeId: leave.employeeId, companyId: primary.companyId, date: day, status: ATTENDANCE_STATUS.LEAVE, source: 'MANUAL', note: 'Approved leave' } })
            }
          }
        }
        await tx.notification.create({
          data: { userId: leave.employee.userId, title: 'Leave approved', message: `Your leave (${leave.days} day(s)) was approved.`, link: '/leaves' },
        })
      } else if (status === LEAVE_STATUS.REJECTED) {
        await tx.notification.create({
          data: { userId: leave.employee.userId, title: 'Leave rejected', message: body.comment || 'Your leave request was rejected.', link: '/leaves' },
        })
      }

      const auditAction = status === LEAVE_STATUS.APPROVED ? AUDIT_ACTIONS.LEAVE_APPROVE : AUDIT_ACTIONS.LEAVE_REJECT
      await logAudit(tx, auth.userId, auditAction, 'LeaveRequest', id, {
        days: leave.days,
        employeeId: leave.employeeId,
        status,
      })

      return rec
    })

    // Transactional email dispatch (no-op unless EMAIL_ENABLED=true)
    if (leave.employee.user?.email && (status === LEAVE_STATUS.APPROVED || status === LEAVE_STATUS.REJECTED)) {
      sendLeaveStatusEmail(leave.employee.user.email, {
        name: leave.employee.user.name || 'Employee',
        leaveType: leave.leaveType?.name || 'Leave',
        startDate: new Date(leave.startDate).toISOString().split('T')[0],
        endDate: new Date(leave.endDate).toISOString().split('T')[0],
        status,
        reviewerComment: body.comment,
      }).catch((err) => console.error('[EMAIL:LEAVE_STATUS_ERROR]', err))
    }

    return Response.json({ ok: true, data: updated })
  })
}
