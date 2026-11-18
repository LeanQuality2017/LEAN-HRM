import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { isPayrollEnabled } from '@/lib/feature-gates'
import { HR_ROLES, PAYROLL_STATUS, PAYROLL_STATUSES, AUDIT_ACTIONS, ROLES } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, payrollCreateSchema, payrollUpdateSchema } from '@/lib/validation'
import { parsePaginationParams } from '@/lib/pagination'

// GET /api/payroll - list payslips (?companyId=&month=&year=)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    if (!isPayrollEnabled()) {
      return Response.json({ ok: true, data: [], page: 1, pageSize: 25, total: 0 })
    }
    const url = new URL(req.url)
    const companyId = url.searchParams.get('companyId')
    const month = url.searchParams.get('month')
    const year = url.searchParams.get('year')

    const scopedIds = await getScopedCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Record<string, unknown> = {}
    if (!HR_ROLES.includes(auth.role)) {
      if (!auth.employeeId) return Response.json({ ok: true, data: [], page: 1, pageSize: 25, total: 0 })
      where.employeeId = auth.employeeId
    } else {
      if (companyId) {
        where.employee = { assignments: { some: { companyId } } }
      } else if (scopedIds) {
        where.employee = { assignments: { some: { companyId: { in: scopedIds } } } }
      }
    }

    if (month) where.month = Number(month)
    if (year) where.year = Number(year)

    const { page, pageSize, skip } = parsePaginationParams(url)

    const [total, data] = await Promise.all([
      db.payroll.count({ where }),
      db.payroll.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        skip,
        take: pageSize,
        include: {
          employee: {
            include: {
              user: { select: { name: true, email: true } },
              assignments: { include: { company: { select: { name: true, code: true } } } },
            },
          },
        },
      }),
    ])

    const serialized = data.map((p) => ({
      ...p,
      basic: Number(p.basic),
      allowances: Number(p.allowances),
      deductions: Number(p.deductions),
      netPay: Number(p.netPay),
    }))

    return Response.json({ ok: true, data: serialized, page, pageSize, total })
  })
}

// POST /api/payroll - generate payroll batch for month/year (HR+)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    if (!isPayrollEnabled()) {
      throw new ApiError(
        403,
        'Payroll generation is disabled outside approved demo environments until durable legal-entity and pay rules are configured'
      )
    }
    const body = validateBody(payrollCreateSchema, await req.json())
    const month = Number(body.month), year = Number(body.year)

    const scopedIds = await getScopedCompanyIds(auth)
    if (body.companyId) {
      assertCompanyInScope(body.companyId, scopedIds)
    }

    const empWhere: Record<string, unknown> = { status: 'ACTIVE' }
    if (body.companyId) {
      empWhere.assignments = { some: { companyId: body.companyId } }
    } else if (scopedIds) {
      empWhere.assignments = { some: { companyId: { in: scopedIds } } }
    }

    const employees = await db.employee.findMany({
      where: empWhere,
      include: { user: true },
    })
    if (!employees.length) throw new ApiError(400, 'No active employees in scope')

    const result = await db.$transaction(async (tx) => {
      let created = 0, skipped = 0
      for (const e of employees) {
        const exists = await tx.payroll.findUnique({ where: { employeeId_month_year: { employeeId: e.id, month, year } } })
        if (exists) { skipped++; continue }
        const baseSalary = Number(e.baseSalary)
        const allowances = Math.round(baseSalary * 0.12)
        const deductions = Math.round(baseSalary * 0.05)
        await tx.payroll.create({
          data: { employeeId: e.id, month, year, basic: baseSalary, allowances, deductions, netPay: baseSalary + allowances - deductions, generatedById: auth.userId },
        })
        created++
        await tx.notification.create({ data: { userId: e.userId, title: 'Payslip generated', message: `Payslip for ${month}/${year} is available.`, link: '/payroll' } })
      }

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_GENERATE, 'Payroll', null, {
        month,
        year,
        created,
        skipped,
      })

      return { created, skipped }
    })

    return Response.json({ ok: true, data: result })
  })
}

// PATCH /api/payroll?id= - update draft or mark PROCESSED/PAID (SUPER_ADMIN only)
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth([ROLES.SUPER_ADMIN])
    if (!isPayrollEnabled()) {
      throw new ApiError(
        403,
        'Payroll modification is disabled outside approved demo environments until durable legal-entity and pay rules are configured'
      )
    }
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(payrollUpdateSchema, await req.json())

    const existing = await db.payroll.findUnique({
      where: { id },
      include: { employee: { include: { assignments: true } } },
    })
    if (!existing) throw new ApiError(404, 'Payslip not found')

    const scopedIds = await getScopedCompanyIds(auth)
    if (scopedIds) {
      const inScope = existing.employee.assignments.some((a) => scopedIds.includes(a.companyId))
      if (!inScope) {
        throw new ApiError(403, 'Forbidden: payslip out of scope')
      }
    }

    // PAID payslips are fully immutable
    if (existing.status === PAYROLL_STATUS.PAID) {
      throw new ApiError(400, 'Paid payslips are fully immutable')
    }

    // Enforce adjacent state transitions: DRAFT -> PROCESSED -> PAID
    if (body.status !== undefined) {
      if (!PAYROLL_STATUSES.includes(body.status)) {
        throw new ApiError(400, 'Invalid payroll status')
      }
      if (existing.status === PAYROLL_STATUS.DRAFT && body.status !== PAYROLL_STATUS.DRAFT && body.status !== PAYROLL_STATUS.PROCESSED) {
        throw new ApiError(400, 'Invalid transition: DRAFT can only move to PROCESSED')
      }
      if (existing.status === PAYROLL_STATUS.PROCESSED && body.status !== PAYROLL_STATUS.PROCESSED && body.status !== PAYROLL_STATUS.PAID) {
        throw new ApiError(400, 'Invalid transition: PROCESSED can only move to PAID')
      }
    }

    const basic = body.basic != null ? Number(body.basic) : Number(existing.basic)
    const allowances = body.allowances != null ? Number(body.allowances) : Number(existing.allowances)
    const deductions = body.deductions != null ? Number(body.deductions) : Number(existing.deductions)

    if (basic < 0 || allowances < 0 || deductions < 0 || isNaN(basic) || isNaN(allowances) || isNaN(deductions)) {
      throw new ApiError(400, 'Payroll amounts cannot be negative')
    }

    const newStatus = body.status ?? existing.status
    const rec = await db.$transaction(async (tx) => {
      const updated = await tx.payroll.update({
        where: { id },
        data: {
          basic,
          allowances,
          deductions,
          netPay: basic + allowances - deductions,
          status: newStatus,
          paidAt: newStatus === PAYROLL_STATUS.PAID ? new Date() : existing.paidAt,
        },
      })

      if (newStatus === PAYROLL_STATUS.PAID) {
        await tx.notification.create({
          data: {
            userId: (await tx.employee.findUnique({ where: { id: updated.employeeId }, select: { userId: true } }))!.userId,
            title: 'Salary paid',
            message: `Salary for ${updated.month}/${updated.year} has been paid.`,
            link: '/payroll',
          },
        })
      }

      if (newStatus === PAYROLL_STATUS.PROCESSED && existing.status !== PAYROLL_STATUS.PROCESSED) {
        await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_PROCESS, 'Payroll', id, {
          month: updated.month,
          year: updated.year,
          netPay: Number(updated.netPay),
        })
      } else if (newStatus === PAYROLL_STATUS.PAID && existing.status !== PAYROLL_STATUS.PAID) {
        await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_PAY, 'Payroll', id, {
          month: updated.month,
          year: updated.year,
          netPay: Number(updated.netPay),
        })
      }

      return updated
    })

    return Response.json({
      ok: true,
      data: {
        ...rec,
        basic: Number(rec.basic),
        allowances: Number(rec.allowances),
        deductions: Number(rec.deductions),
        netPay: Number(rec.netPay),
      },
    })
  })
}
