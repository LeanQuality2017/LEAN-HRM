import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, verifySuperadminStepUp } from '@/lib/api-auth'
import { ROLES, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, companyDeleteSchema } from '@/lib/validation'

const PROTECTED_CODES = ['ALPHA', 'BETA', 'SKILLEDGE']

// POST /api/companies/[id]/delete - Hard delete company with superadmin step-up auth
export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const auth = await requireAuth([ROLES.SUPER_ADMIN])
    const { id } = await props.params
    if (!id) throw new ApiError(400, 'Company id is required')

    const rawBody = await req.json().catch(() => ({}))
    const body = validateBody(companyDeleteSchema, rawBody)

    // Reusable superadmin step-up auth helper: checks role, rate limiter, scrypt password match
    await verifySuperadminStepUp(auth, body.email, body.password, req)

    // Check company existence
    const company = await db.company.findUnique({
      where: { id },
    })
    if (!company) {
      throw new ApiError(404, 'Company not found')
    }

    // Safety guard: protected seed companies must never be deleted
    if (PROTECTED_CODES.includes(company.code.toUpperCase())) {
      throw new ApiError(403, 'Seed demo companies cannot be deleted')
    }

    // Confirmation name must match exact company name
    if (body.confirmName !== company.name) {
      throw new ApiError(400, 'Company name confirmation does not match')
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Identify all employees assigned to this company
      const assignments = await tx.employeeCompanyAssignment.findMany({
        where: { companyId: id },
        select: { employeeId: true },
      })
      const assignedEmployeeIds = assignments.map((a) => a.employeeId)

      // Identify multi-company employees vs exclusive employees
      const otherAssignments = await tx.employeeCompanyAssignment.findMany({
        where: {
          employeeId: { in: assignedEmployeeIds },
          companyId: { not: id },
        },
        select: { employeeId: true },
      })
      const multiCompanyEmployeeIds = new Set(otherAssignments.map((a) => a.employeeId))
      const exclusiveEmployeeIds = assignedEmployeeIds.filter((empId) => !multiCompanyEmployeeIds.has(empId))

      // Identify user IDs for exclusive employees
      const employeesToDelete = await tx.employee.findMany({
        where: { id: { in: exclusiveEmployeeIds } },
        select: { id: true, userId: true },
      })
      const employeeUserIds = employeesToDelete.map((e) => e.userId)

      // Identify users scoped to this company
      const scopedUsers = await tx.userCompanyScope.findMany({
        where: { companyId: id },
        select: { userId: true },
      })
      const assignedUserIds = scopedUsers.map((s) => s.userId)

      const otherScopes = await tx.userCompanyScope.findMany({
        where: {
          userId: { in: assignedUserIds },
          companyId: { not: id },
        },
        select: { userId: true },
      })
      const multiCompanyUserIds = new Set(otherScopes.map((s) => s.userId))

      const candidateUserIds = Array.from(new Set([...employeeUserIds, ...assignedUserIds]))
      const candidateUsers = candidateUserIds.length
        ? await tx.user.findMany({
            where: { id: { in: candidateUserIds } },
            select: { id: true, role: true },
          })
        : []

      // Exclusive users: not SUPER_ADMIN and no assignments/scopes in other companies
      const exclusiveUserIds = candidateUsers
        .filter((u) => u.role !== ROLES.SUPER_ADMIN && !multiCompanyUserIds.has(u.id))
        .map((u) => u.id)

      const deletedCounts: Record<string, number> = {}

      // 2. Clear managerId references for employees reporting to employees being deleted
      if (exclusiveEmployeeIds.length) {
        await tx.employee.updateMany({
          where: { managerId: { in: exclusiveEmployeeIds } },
          data: { managerId: null },
        })
      }

      // 3. Announcements
      const delAnnouncements = await tx.announcement.deleteMany({
        where: {
          OR: [
            { companyId: id },
            ...(exclusiveUserIds.length ? [{ createdById: { in: exclusiveUserIds } }] : []),
          ],
        },
      })
      deletedCounts.announcements = delAnnouncements.count

      // 4. Work report comments
      const delComments = await tx.workReportComment.deleteMany({
        where: {
          OR: [
            { report: { companyId: id } },
            ...(exclusiveUserIds.length ? [{ userId: { in: exclusiveUserIds } }] : []),
            ...(exclusiveEmployeeIds.length ? [{ report: { employeeId: { in: exclusiveEmployeeIds } } }] : []),
          ],
        },
      })
      deletedCounts.workReportComments = delComments.count

      // 5. Daily work reports
      const delReports = await tx.dailyWorkReport.deleteMany({
        where: {
          OR: [
            { companyId: id },
            ...(exclusiveEmployeeIds.length ? [{ employeeId: { in: exclusiveEmployeeIds } }] : []),
          ],
        },
      })
      deletedCounts.workReports = delReports.count

      // 6. Attendance
      const delAttendance = await tx.attendance.deleteMany({
        where: {
          OR: [
            { companyId: id },
            ...(exclusiveEmployeeIds.length ? [{ employeeId: { in: exclusiveEmployeeIds } }] : []),
          ],
        },
      })
      deletedCounts.attendance = delAttendance.count

      // 7. Performance reviews
      if (exclusiveEmployeeIds.length || exclusiveUserIds.length) {
        const delReviews = await tx.performanceReview.deleteMany({
          where: {
            OR: [
              ...(exclusiveEmployeeIds.length ? [{ employeeId: { in: exclusiveEmployeeIds } }] : []),
              ...(exclusiveUserIds.length ? [{ reviewerId: { in: exclusiveUserIds } }] : []),
            ],
          },
        })
        deletedCounts.performanceReviews = delReviews.count
      }

      // 8. KPIs
      if (exclusiveEmployeeIds.length) {
        const delKpis = await tx.kPI.deleteMany({
          where: { employeeId: { in: exclusiveEmployeeIds } },
        })
        deletedCounts.kpis = delKpis.count
      }

      // 9. Payroll: clear generatedById then delete employee payrolls
      if (exclusiveUserIds.length) {
        await tx.payroll.updateMany({
          where: { generatedById: { in: exclusiveUserIds } },
          data: { generatedById: null },
        })
      }
      if (exclusiveEmployeeIds.length) {
        const delPayrolls = await tx.payroll.deleteMany({
          where: { employeeId: { in: exclusiveEmployeeIds } },
        })
        deletedCounts.payrolls = delPayrolls.count
      }

      // 10. Leave requests: clear reviewedById then delete leave requests
      if (exclusiveUserIds.length) {
        await tx.leaveRequest.updateMany({
          where: { reviewedById: { in: exclusiveUserIds } },
          data: { reviewedById: null },
        })
      }
      const delLeaveRequests = await tx.leaveRequest.deleteMany({
        where: {
          OR: [
            { leaveType: { companyId: id } },
            ...(exclusiveEmployeeIds.length ? [{ employeeId: { in: exclusiveEmployeeIds } }] : []),
          ],
        },
      })
      deletedCounts.leaveRequests = delLeaveRequests.count

      // 11. Leave types
      const delLeaveTypes = await tx.leaveType.deleteMany({
        where: { companyId: id },
      })
      deletedCounts.leaveTypes = delLeaveTypes.count

      // 12. Recruitment: JobApplications then JobOpenings
      const delJobApps = await tx.jobApplication.deleteMany({
        where: { jobOpening: { companyId: id } },
      })
      deletedCounts.jobApplications = delJobApps.count

      const delJobOpenings = await tx.jobOpening.deleteMany({
        where: { companyId: id },
      })
      deletedCounts.jobOpenings = delJobOpenings.count

      // 13. Departments
      const delDepartments = await tx.department.deleteMany({
        where: { companyId: id },
      })
      deletedCounts.departments = delDepartments.count

      // 14. FeePayment receivedById
      if (exclusiveUserIds.length) {
        await tx.feePayment.updateMany({
          where: { receivedById: { in: exclusiveUserIds } },
          data: { receivedById: null },
        })
      }

      // 15. EmployeeCompanyAssignments
      const delAssignments = await tx.employeeCompanyAssignment.deleteMany({
        where: {
          OR: [
            { companyId: id },
            ...(exclusiveEmployeeIds.length ? [{ employeeId: { in: exclusiveEmployeeIds } }] : []),
          ],
        },
      })
      deletedCounts.employeeCompanyAssignments = delAssignments.count

      // 16. Exclusive Employees
      if (exclusiveEmployeeIds.length) {
        const delEmployees = await tx.employee.deleteMany({
          where: { id: { in: exclusiveEmployeeIds } },
        })
        deletedCounts.employees = delEmployees.count
      }

      // 17. UserCompanyScopes
      const delScopes = await tx.userCompanyScope.deleteMany({
        where: {
          OR: [
            { companyId: id },
            ...(exclusiveUserIds.length ? [{ userId: { in: exclusiveUserIds } }] : []),
          ],
        },
      })
      deletedCounts.userCompanyScopes = delScopes.count

      // 18. Notifications
      if (exclusiveUserIds.length) {
        const delNotifications = await tx.notification.deleteMany({
          where: { userId: { in: exclusiveUserIds } },
        })
        deletedCounts.notifications = delNotifications.count

        // Audit logs authored by deleted users
        await tx.auditLog.deleteMany({
          where: { userId: { in: exclusiveUserIds } },
        })
      }

      // 19. Exclusive Users
      if (exclusiveUserIds.length) {
        const delUsers = await tx.user.deleteMany({
          where: { id: { in: exclusiveUserIds } },
        })
        deletedCounts.users = delUsers.count
      }

      // 20. Company
      await tx.company.delete({
        where: { id },
      })
      deletedCounts.company = 1

      // 21. Log Audit
      await logAudit(tx, auth.userId, AUDIT_ACTIONS.COMPANY_DELETE, 'Company', id, {
        companyName: company.name,
        companyCode: company.code,
        deletedCounts,
      })

      return { companyName: company.name, deletedCounts }
    })

    return Response.json({
      ok: true,
      deleted: true,
      companyName: result.companyName,
      deletedCounts: result.deletedCounts,
    })
  })
}

