import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES, LEAVE_STATUS } from '@/lib/constants'
import { validateBody, leaveCreateSchema } from '@/lib/validation'
import { parsePaginationParams } from '@/lib/pagination'
import {
  computeAvailableBalance,
  assertCanApply,
  getLeaveYear,
  getLeaveYearBoundaries,
  LeaveBalanceError,
} from '@/lib/leave'

// POST /api/leaves - apply for leave (employee or HR on behalf)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'])
    const body = validateBody(leaveCreateSchema, await req.json())

    let targetEmployeeId = auth.employeeId
    if (HR_ROLES.includes(auth.role)) {
      if (body.employeeId) {
        targetEmployeeId = body.employeeId
      } else if (!targetEmployeeId) {
        const scopedIds = await getScopedCompanyIds(auth)
        const emp = await db.employee.findFirst({
          where: scopedIds ? { assignments: { some: { companyId: { in: scopedIds } } } } : {},
        })
        if (emp) targetEmployeeId = emp.id
      }
    }
    if (!targetEmployeeId) throw new ApiError(400, 'Not an employee account')

    if (!body.leaveTypeId || !body.startDate || !body.endDate || !body.reason) {
      throw new ApiError(400, 'leaveTypeId, startDate, endDate, reason are required')
    }

    const start = new Date(body.startDate)
    const end = new Date(body.endDate)
    start.setHours(0, 0, 0, 0)
    end.setHours(0, 0, 0, 0)

    if (end < start) throw new ApiError(400, 'End date must be after start date')
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
    if (days <= 0) throw new ApiError(400, 'Leave days must be greater than 0')

    // Past-date leave policy:
    // HR_ROLES may backdate up to 7 days.
    // Non-HR applications must have startDate >= today.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (HR_ROLES.includes(auth.role)) {
      const minDate = new Date(today.getTime() - 7 * 86400000)
      if (start < minDate) {
        throw new ApiError(400, 'Leave backdating cannot exceed 7 days')
      }
    } else {
      if (start < today) {
        throw new ApiError(400, 'Leave start date cannot be in the past')
      }
    }

    const year = getLeaveYear(start)
    const { yearStart, yearEnd } = getLeaveYearBoundaries(year)

    // Wrap read + balance check + overlap + create in a transaction to prevent race conditions
    const leave = await db.$transaction(async (tx) => {
      // Validate leaveTypeId exists and belongs to a company where the target employee is assigned
      const leaveType = await tx.leaveType.findFirst({
        where: {
          id: body.leaveTypeId,
          company: {
            assignments: {
              some: { employeeId: targetEmployeeId },
            },
          },
        },
      })
      if (!leaveType) {
        throw new ApiError(400, 'Invalid leaveTypeId: leave type does not exist or does not belong to employee company')
      }

      if (HR_ROLES.includes(auth.role) && auth.role !== 'SUPER_ADMIN') {
        const scopedIds = await getScopedCompanyIds(auth)
        assertCompanyInScope(leaveType.companyId, scopedIds)
      }

      // Check balance if leave type is paid; isUnpaid types bypass balance check
      if (!leaveType.isUnpaid) {
        const leaveBalance = await tx.leaveBalance.findUnique({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: targetEmployeeId,
              leaveTypeId: body.leaveTypeId,
              year,
            },
          },
        })

        const pendingRequests = await tx.leaveRequest.findMany({
          where: {
            employeeId: targetEmployeeId,
            leaveTypeId: body.leaveTypeId,
            status: LEAVE_STATUS.PENDING,
            startDate: { gte: yearStart, lte: yearEnd },
          },
          select: { days: true },
        })
        const pendingDays = pendingRequests.reduce((sum, r) => sum + r.days, 0)

        const available = computeAvailableBalance({
          credited: leaveBalance?.credited ?? 0,
          carriedForward: leaveBalance?.carriedForward ?? 0,
          used: leaveBalance?.used ?? 0,
          pending: pendingDays,
        }).available

        try {
          assertCanApply({
            available,
            requestedDays: days,
            isUnpaid: false,
          })
        } catch (err) {
          if (err instanceof LeaveBalanceError) {
            throw new ApiError(400, err.message)
          }
          throw err
        }
      }

      // Overlap check: reject 409 when request overlaps existing PENDING or APPROVED leave
      const overlapping = await tx.leaveRequest.findFirst({
        where: {
          employeeId: targetEmployeeId,
          status: { in: [LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED] },
          startDate: { lte: end },
          endDate: { gte: start },
        },
      })
      if (overlapping) {
        throw new ApiError(409, 'An overlapping pending or approved leave request already exists')
      }

      return tx.leaveRequest.create({
        data: {
          employeeId: targetEmployeeId,
          leaveTypeId: body.leaveTypeId,
          startDate: start,
          endDate: end,
          days,
          reason: body.reason,
        },
      })
    })

    return Response.json({ ok: true, data: leave }, { status: 201 })
  })
}

// GET /api/leaves - own leaves (?scope=mine) or team leaves for reviewers (?scope=all&status=PENDING&companyId=)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const scope = url.searchParams.get('scope') || 'mine'
    const status = url.searchParams.get('status') || undefined
    const companyId = url.searchParams.get('companyId') || undefined

    const scopedIds = await getScopedCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Record<string, unknown> = {}
    if (scope === 'mine') {
      if (!auth.employeeId) return Response.json({ ok: true, data: [], page: 1, pageSize: 25, total: 0 })
      where.employeeId = auth.employeeId
    } else if (auth.employeeId || ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'].includes(auth.role)) {
      if (!['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'].includes(auth.role)) {
        where.employee = { managerId: auth.employeeId }
      }
      if (companyId) {
        where.employee = { ...(where.employee as object || {}), assignments: { some: { companyId } } }
      } else if (scopedIds) {
        where.employee = { ...(where.employee as object || {}), assignments: { some: { companyId: { in: scopedIds } } } }
      }
    } else {
      return Response.json({ ok: true, data: [], page: 1, pageSize: 25, total: 0 })
    }
    if (status) where.status = status

    const { page, pageSize, skip } = parsePaginationParams(url)

    const [total, data] = await Promise.all([
      db.leaveRequest.count({ where }),
      db.leaveRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          employee: { select: { employeeCode: true, user: { select: { name: true } } } },
          leaveType: { select: { name: true } },
          reviewedBy: { select: { name: true } },
        },
      }),
    ])

    return Response.json({ ok: true, data, page, pageSize, total })
  })
}
