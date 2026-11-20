import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds } from '@/lib/api-auth'
import { LEAVE_STATUS } from '@/lib/constants'
import {
  computeAvailableBalance,
  getLeaveYear,
  getLeaveYearBoundaries,
} from '@/lib/leave'

// GET /api/leaves/balance?employeeId=&year=
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const employeeIdParam = url.searchParams.get('employeeId')

    // Determine target employee ID
    let targetEmployeeId = auth.employeeId

    if (employeeIdParam) {
      if (auth.role === 'EMPLOYEE' && employeeIdParam !== auth.employeeId) {
        throw new ApiError(403, 'Forbidden: employees can only view their own leave balance')
      }
      targetEmployeeId = employeeIdParam
    }

    if (!targetEmployeeId) {
      throw new ApiError(400, 'Employee ID required')
    }

    // Resolve employee and verify tenant scope
    const employee = await db.employee.findUnique({
      where: { id: targetEmployeeId },
      include: {
        assignments: { select: { companyId: true } },
      },
    })

    if (!employee) {
      throw new ApiError(404, 'Employee not found')
    }

    // Authorization & tenant isolation checks
    if (auth.role !== 'SUPER_ADMIN') {
      const scopedIds = await getScopedCompanyIds(auth)
      if (scopedIds) {
        const inScope = employee.assignments.some((a) => scopedIds.includes(a.companyId))
        if (!inScope) {
          throw new ApiError(403, 'Forbidden: employee out of scope')
        }
      }

      if (auth.role === 'MANAGER' && targetEmployeeId !== auth.employeeId && employee.managerId !== auth.employeeId) {
        throw new ApiError(403, 'Forbidden: managers can only view direct reports')
      }
    }

    // Resolve leave year
    const yearParam = url.searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : getLeaveYear(new Date())
    const { yearStart, yearEnd } = getLeaveYearBoundaries(year)

    // Find all leave types for the employee's assigned companies
    const companyIds = employee.assignments.map((a) => a.companyId)
    const leaveTypes = await db.leaveType.findMany({
      where: { companyId: { in: companyIds } },
      orderBy: { name: 'asc' },
    })

    // Fetch existing balances for this year
    const balances = await db.leaveBalance.findMany({
      where: {
        employeeId: targetEmployeeId,
        year,
      },
    })

    // Fetch all pending requests for this employee in the leave year
    const pendingRequests = await db.leaveRequest.findMany({
      where: {
        employeeId: targetEmployeeId,
        status: LEAVE_STATUS.PENDING,
        startDate: { gte: yearStart, lte: yearEnd },
      },
      select: {
        leaveTypeId: true,
        days: true,
      },
    })

    // Compute balance details per leave type
    const data = leaveTypes.map((lt) => {
      const bal = balances.find((b) => b.leaveTypeId === lt.id)
      const pendingDec = pendingRequests
        .filter((r) => r.leaveTypeId === lt.id)
        .reduce(
          (sum, r) => sum.add(new Prisma.Decimal(r.days.toString())),
          new Prisma.Decimal('0.00')
        )

      const credited = bal ? bal.credited : new Prisma.Decimal('0.00')
      const carriedForward = bal ? bal.carriedForward : new Prisma.Decimal('0.00')
      const used = bal ? bal.used : new Prisma.Decimal('0.00')

      const available = lt.isUnpaid
        ? new Prisma.Decimal('0.00')
        : computeAvailableBalance({
            credited,
            carriedForward,
            used,
            pending: pendingDec,
          }).available

      return {
        leaveTypeId: lt.id,
        leaveTypeName: lt.name,
        isUnpaid: lt.isUnpaid,
        year,
        credited: credited.toFixed(2),
        carriedForward: carriedForward.toFixed(2),
        used: used.toFixed(2),
        pending: pendingDec.toFixed(2),
        available: available.toFixed(2),
      }
    })

    return Response.json({ ok: true, data })
  })
}

