import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { MANAGEMENT_ROLES, REPORT_STATUS, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, workReportReviewSchema } from '@/lib/validation'

// PATCH /api/work-reports/:id - manager review comment (marks REVIEWED)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(MANAGEMENT_ROLES)
    const { id } = await params
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(workReportReviewSchema, await req.json())

    const report = await db.dailyWorkReport.findUnique({ where: { id }, include: { employee: true } })
    if (!report) throw new ApiError(404, 'Report not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(report.companyId, scopedIds)

    if (auth.role === 'MANAGER' && auth.employeeId && report.employee.managerId !== auth.employeeId) {
      throw new ApiError(403, 'You can only review reports of your direct reports')
    }

    const { updated, comment } = await db.$transaction(async (tx) => {
      const comm = await tx.workReportComment.create({
        data: { reportId: id, userId: auth.userId, comment: body.comment },
      })
      const rep = await tx.dailyWorkReport.update({
        where: { id },
        data: { status: REPORT_STATUS.REVIEWED },
      })
      await tx.notification.create({
        data: {
          userId: report.employee.userId,
          title: 'Work report reviewed',
          message: body.comment,
          link: '/work-reports',
        },
      })
      await logAudit(tx, auth.userId, AUDIT_ACTIONS.WORK_REPORT_REVIEW, 'DailyWorkReport', id, {
        employeeId: report.employeeId,
        date: report.date,
      })
      return { updated: rep, comment: comm }
    })

    return Response.json({ ok: true, data: { ...updated, comments: [comment] } })
  })
}
