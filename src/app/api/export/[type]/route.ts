import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds } from '@/lib/api-auth'
import { isPayrollEnabled, isInstituteEnabled } from '@/lib/feature-gates'
import { HR_ROLES, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { EXPORT_TYPES, exportQuerySchema, formatCsvCell } from '@/lib/validation'

// NOTE: Auth: HR_ROLES only (SUPER_ADMIN, COMPANY_ADMIN, HR).
// EMPLOYEE, MANAGER, and STUDENT roles are rejected with HTTP 403 Forbidden.

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  return handle(async () => {
    // 1. Authorize caller - strictly HR_ROLES (SUPER_ADMIN, COMPANY_ADMIN, HR)
    const auth = await requireAuth(HR_ROLES)
    const { type } = await params

    if (!EXPORT_TYPES.includes(type as any)) {
      throw new ApiError(404, `Unknown export type: ${type}`)
    }

    const scopedIds = await getScopedCompanyIds(auth)
    const url = new URL(req.url)
    const rawFrom = url.searchParams.get('from') || undefined
    const rawTo = url.searchParams.get('to') || undefined

    const queryParsed = exportQuerySchema.safeParse({ from: rawFrom, to: rawTo })
    if (!queryParsed.success) {
      const issue = queryParsed.error.issues[0]
      throw new ApiError(400, `Invalid query parameter: ${issue?.message || 'invalid date'}`)
    }

    const { from, to } = queryParsed.data

    // Attendance and Fees require date range
    if (type === 'attendance' || type === 'fees') {
      if (!from || !to) {
        throw new ApiError(400, `from and to query parameters (YYYY-MM-DD) are required for ${type} export`)
      }
    }

    let fromDate: Date | undefined
    let toDate: Date | undefined

    if (from && to) {
      if (from > to) {
        throw new ApiError(400, 'from date cannot be after to date')
      }
      fromDate = new Date(`${from}T00:00:00.000Z`)
      toDate = new Date(`${to}T23:59:59.999Z`)

      const diffDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1
      if (diffDays > 366) {
        throw new ApiError(400, 'Date range cannot exceed 366 days')
      }
    }

    let header: string[] = []
    let dataLines: string[] = []
    let rowCount = 0

    if (type === 'attendance') {
      header = ['date', 'employeeCode', 'name', 'company', 'checkIn', 'checkOut', 'status', 'source']
      const where: Record<string, unknown> = {}
      if (scopedIds) {
        where.companyId = { in: scopedIds }
      }
      if (fromDate && toDate) {
        where.date = { gte: fromDate, lte: toDate }
      }

      const rows = await db.attendance.findMany({
        where,
        orderBy: { date: 'asc' },
        include: {
          employee: { select: { employeeCode: true, user: { select: { name: true } } } },
          company: { select: { name: true } },
        },
        take: 10001,
      })

      if (rows.length > 10000) {
        throw new ApiError(400, 'Export exceeds maximum limit of 10,000 rows. Please select a narrower date range.')
      }

      rowCount = rows.length
      dataLines = rows.map((r) => [
        formatCsvCell(r.date.toISOString().slice(0, 10)),
        formatCsvCell(r.employee.employeeCode),
        formatCsvCell(r.employee.user.name),
        formatCsvCell(r.company.name),
        formatCsvCell(r.checkIn ? r.checkIn.toISOString() : ''),
        formatCsvCell(r.checkOut ? r.checkOut.toISOString() : ''),
        formatCsvCell(r.status),
        formatCsvCell(r.source),
      ].join(','))
    } else if (type === 'payroll') {
      if (!isPayrollEnabled()) {
        throw new ApiError(
          403,
          'Forbidden: payroll export is disabled outside approved demo environments until durable legal-entity and pay rules are configured'
        )
      }
      header = ['month', 'year', 'employeeCode', 'name', 'basic', 'allowances', 'deductions', 'netPay', 'status', 'paidAt']
      const where: Record<string, unknown> = {}
      if (scopedIds) {
        where.employee = { assignments: { some: { companyId: { in: scopedIds } } } }
      }
      if (fromDate && toDate) {
        where.createdAt = { gte: fromDate, lte: toDate }
      }

      const rows = await db.payroll.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: {
          employee: { select: { employeeCode: true, user: { select: { name: true } } } },
        },
        take: 10001,
      })

      if (rows.length > 10000) {
        throw new ApiError(400, 'Export exceeds maximum limit of 10,000 rows. Please select a narrower date range.')
      }

      rowCount = rows.length
      dataLines = rows.map((r) => [
        formatCsvCell(r.month),
        formatCsvCell(r.year),
        formatCsvCell(r.employee.employeeCode),
        formatCsvCell(r.employee.user.name),
        formatCsvCell(Number(r.basic)),
        formatCsvCell(Number(r.allowances)),
        formatCsvCell(Number(r.deductions)),
        formatCsvCell(Number(r.netPay)),
        formatCsvCell(r.status),
        formatCsvCell(r.paidAt ? r.paidAt.toISOString() : ''),
      ].join(','))
    } else if (type === 'students') {
      if (!isInstituteEnabled()) {
        throw new ApiError(403, 'Forbidden: institute student export is disabled outside approved demo environments')
      }
      header = ['code', 'name', 'email', 'phone', 'qualification', 'status', 'course', 'batch', 'enrolledAt']

      const institute = await db.company.findFirst({ where: { type: 'INSTITUTE' }, select: { id: true } })
      if (!institute || (scopedIds && !scopedIds.includes(institute.id))) {
        // Staff without institute scope see 0 rows
        rowCount = 0
        dataLines = []
      } else {
        const where: Record<string, unknown> = {}
        if (fromDate && toDate) {
          where.createdAt = { gte: fromDate, lte: toDate }
        }

        const rows = await db.student.findMany({
          where,
          orderBy: { code: 'asc' },
          include: {
            enrollments: {
              include: {
                batch: {
                  include: {
                    course: true,
                  },
                },
              },
              orderBy: { enrolledAt: 'desc' },
            },
          },
          take: 10001,
        })

        if (rows.length > 10000) {
          throw new ApiError(400, 'Export exceeds maximum limit of 10,000 rows. Please select a narrower date range.')
        }

        rowCount = rows.length
        dataLines = rows.map((r) => {
          const primaryEnroll = r.enrollments[0]
          return [
            formatCsvCell(r.code),
            formatCsvCell(r.name),
            formatCsvCell(r.email || ''),
            formatCsvCell(r.phone || ''),
            formatCsvCell(r.qualification || ''),
            formatCsvCell(r.status),
            formatCsvCell(primaryEnroll?.batch?.course?.name || ''),
            formatCsvCell(primaryEnroll?.batch?.name || ''),
            formatCsvCell(
              primaryEnroll?.enrolledAt
                ? primaryEnroll.enrolledAt.toISOString().slice(0, 10)
                : r.createdAt.toISOString().slice(0, 10)
            ),
          ].join(',')
        })
      }
    } else if (type === 'fees') {
      if (!isInstituteEnabled()) {
        throw new ApiError(403, 'Forbidden: institute fee export is disabled outside approved demo environments')
      }
      header = ['invoiceNo', 'paidAt', 'studentCode', 'studentName', 'amount', 'method', 'receivedBy', 'note']

      const institute = await db.company.findFirst({ where: { type: 'INSTITUTE' }, select: { id: true } })
      if (!institute || (scopedIds && !scopedIds.includes(institute.id))) {
        // Staff without institute scope see 0 rows
        rowCount = 0
        dataLines = []
      } else {
        const where: Record<string, unknown> = {
          paidAt: { gte: fromDate!, lte: toDate! },
        }

        const rows = await db.feePayment.findMany({
          where,
          orderBy: { paidAt: 'desc' },
          include: {
            student: { select: { code: true, name: true } },
            receivedBy: { select: { name: true } },
          },
          take: 10001,
        })

        if (rows.length > 10000) {
          throw new ApiError(400, 'Export exceeds maximum limit of 10,000 rows. Please select a narrower date range.')
        }

        rowCount = rows.length
        dataLines = rows.map((r) => [
          formatCsvCell(r.invoiceNo),
          formatCsvCell(r.paidAt.toISOString()),
          formatCsvCell(r.student.code),
          formatCsvCell(r.student.name),
          formatCsvCell(Number(r.amount)),
          formatCsvCell(r.method),
          formatCsvCell(r.receivedBy?.name || ''),
          formatCsvCell(r.note || ''),
        ].join(','))
      }
    }

    // 2. Audit log row for export action
    await logAudit(db, auth.userId, AUDIT_ACTIONS.EXPORT, 'Export', null, {
      type,
      from: from || null,
      to: to || null,
      rowCount,
    })

    // 3. Output CSV with UTF-8 BOM (\ufeff) and attachment header
    const csvContent = '\ufeff' + [header.join(','), ...dataLines].join('\r\n')
    const filename = from && to ? `unihr-${type}-${from}_${to}.csv` : `unihr-${type}-all.csv`

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  })
}

