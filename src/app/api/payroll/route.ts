import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  requireAuth,
  handle,
  ApiError,
  getScopedCompanyIds,
  assertCompanyInScope,
  verifySuperadminStepUp,
} from '@/lib/api-auth'
import { isPayrollEnabled } from '@/lib/feature-gates'
import {
  HR_ROLES,
  PAYROLL_STATUS,
  PAYROLL_STATUSES,
  AUDIT_ACTIONS,
  ROLES,
} from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, payrollCreateSchema, payrollUpdateSchema } from '@/lib/validation'
import { parsePaginationParams } from '@/lib/pagination'
import { sendPayslipReadyEmail } from '@/lib/mail'
import { computePayslip, DeclaredDeductionsInput, PayrollCalculationError, PayrollLineDraft } from '@/lib/payroll'

/**
 * Validates strict adjacent state transitions:
 * DRAFT -> LOCKED -> PROCESSED -> PAID
 * - Cannot skip states (e.g. DRAFT -> PROCESSED is forbidden).
 * - Cannot reverse states (e.g. LOCKED -> DRAFT is forbidden).
 * - PAID is completely immutable.
 */
export function validateAdjacentStatusTransition(currentStatus: string, nextStatus: string): void {
  if (currentStatus === PAYROLL_STATUS.PAID) {
    throw new ApiError(400, 'Paid payroll records are fully immutable')
  }
  if (currentStatus === nextStatus) {
    return
  }

  const validTransitions: Record<string, string> = {
    [PAYROLL_STATUS.DRAFT]: PAYROLL_STATUS.LOCKED,
    [PAYROLL_STATUS.LOCKED]: PAYROLL_STATUS.PROCESSED,
    [PAYROLL_STATUS.PROCESSED]: PAYROLL_STATUS.PAID,
  }

  const expectedNext = validTransitions[currentStatus]
  if (nextStatus !== expectedNext) {
    throw new ApiError(
      400,
      `Invalid transition: ${currentStatus} can only move to ${expectedNext}. Adjacent forward transitions only.`
    )
  }
}

// GET /api/payroll - list payroll runs and lines, paginated, tenant-scoped
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
    const runId = url.searchParams.get('runId')

    const scopedIds = await getScopedCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const isHrOrAdmin = HR_ROLES.includes(auth.role)
    const { page, pageSize, skip } = parsePaginationParams(url)

    // Build PayrollLine query filter
    const whereLine: Prisma.PayrollLineWhereInput = {}

    if (!isHrOrAdmin) {
      // Employees see only their own lines
      if (!auth.employeeId) {
        return Response.json({ ok: true, data: [], page, pageSize, total: 0 })
      }
      whereLine.employeeId = auth.employeeId
    } else {
      if (companyId) {
        whereLine.run = { companyId }
      } else if (scopedIds) {
        whereLine.run = { companyId: { in: scopedIds } }
      }
    }

    if (runId) {
      whereLine.runId = runId
    }

    if (month || year) {
      whereLine.run = {
        ...((whereLine.run as Prisma.PayrollRunWhereInput) || {}),
        ...(month ? { month: Number(month) } : {}),
        ...(year ? { year: Number(year) } : {}),
      }
    }

    const [totalLines, lines] = await Promise.all([
      db.payrollLine.count({ where: whereLine }),
      db.payrollLine.findMany({
        where: whereLine,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          run: {
            select: {
              id: true,
              companyId: true,
              month: true,
              year: true,
              status: true,
              totalGross: true,
              totalNet: true,
            },
          },
          employee: {
            select: {
              id: true,
              employeeCode: true,
              user: { select: { name: true, email: true } },
              assignments: {
                include: { company: { select: { name: true, code: true } } },
              },
            },
          },
        },
      }),
    ])

    // If new v2 lines exist, return them with backwards-compatible aliases
    if (totalLines > 0) {
      const serialized = lines.map((l) => ({
        id: l.id,
        runId: l.runId,
        employeeId: l.employeeId,
        gross: Number(l.gross),
        deductions: Number(l.deductions),
        statutory: Number(l.statutory),
        net: Number(l.net),
        daysPaid: Number(l.daysPaid),
        lopDays: Number(l.lopDays),
        componentBreakdown: l.componentBreakdown,
        // Legacy compatibility properties:
        basic: Number(l.gross) * 0.5,
        allowances: Number(l.gross) * 0.5,
        netPay: Number(l.net),
        status: l.run.status,
        month: l.run.month,
        year: l.run.year,
        employee: l.employee,
      }))

      return Response.json({ ok: true, data: serialized, page, pageSize, total: totalLines })
    }

    // Fallback: Query legacy Payroll table if no v2 lines present yet
    const whereLegacy: Prisma.PayrollWhereInput = {}
    if (!isHrOrAdmin) {
      if (!auth.employeeId) return Response.json({ ok: true, data: [], page, pageSize, total: 0 })
      whereLegacy.employeeId = auth.employeeId
    } else {
      if (companyId) {
        whereLegacy.employee = { assignments: { some: { companyId } } }
      } else if (scopedIds) {
        whereLegacy.employee = { assignments: { some: { companyId: { in: scopedIds } } } }
      }
    }

    if (month) whereLegacy.month = Number(month)
    if (year) whereLegacy.year = Number(year)

    const [totalLegacy, legacyData] = await Promise.all([
      db.payroll.count({ where: whereLegacy }),
      db.payroll.findMany({
        where: whereLegacy,
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

    const serializedLegacy = legacyData.map((p) => ({
      ...p,
      basic: Number(p.basic),
      allowances: Number(p.allowances),
      deductions: Number(p.deductions),
      netPay: Number(p.netPay),
    }))

    return Response.json({ ok: true, data: serializedLegacy, page, pageSize, total: totalLegacy })
  })
}

// POST /api/payroll - generate payroll run through engine (HR+)
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
    const month = Number(body.month)
    const year = Number(body.year)

    const scopedIds = await getScopedCompanyIds(auth)
    if (body.companyId) {
      assertCompanyInScope(body.companyId, scopedIds)
    }

    // Resolve target company for this payroll run
    let targetCompanyId = body.companyId
    if (!targetCompanyId) {
      if (scopedIds && scopedIds.length === 1) {
        targetCompanyId = scopedIds[0]
      } else {
        const company = await db.company.findFirst({
          where: scopedIds ? { id: { in: scopedIds }, isActive: true } : { isActive: true },
          select: { id: true },
        })
        if (!company) {
          throw new ApiError(400, 'companyId is required to generate a payroll run')
        }
        targetCompanyId = company.id
      }
    }

    // Idempotency check: re-running for the same company/month/year returns the existing run
    const existingRun = await db.payrollRun.findUnique({
      where: {
        companyId_month_year: {
          companyId: targetCompanyId,
          month,
          year,
        },
      },
      include: {
        lines: {
          include: {
            employee: {
              select: {
                employeeCode: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
        },
      },
    })

    if (existingRun) {
      // LOCKED, PROCESSED, or PAID blocks recompute; DRAFT returns existing run idempotently
      return Response.json({
        ok: true,
        data: {
          id: existingRun.id,
          companyId: existingRun.companyId,
          month: existingRun.month,
          year: existingRun.year,
          status: existingRun.status,
          totalGross: Number(existingRun.totalGross),
          totalDeductions: Number(existingRun.totalDeductions),
          totalStatutory: Number(existingRun.totalStatutory),
          totalNet: Number(existingRun.totalNet),
          created: 0,
          skipped: [], // array, never omitted
          skippedCount: existingRun.lines.length,
          lines: existingRun.lines,
          isIdempotent: true,
          recomputeBlocked: existingRun.status !== PAYROLL_STATUS.DRAFT,
        },
      })
    }

    // Query active employees assigned to target company
    const employees = await db.employee.findMany({
      where: {
        status: 'ACTIVE',
        assignments: { some: { companyId: targetCompanyId } },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        salaryStructures: {
          include: { components: true },
          orderBy: { effectiveFrom: 'desc' },
        },
        salaryRevisions: {
          orderBy: { effectiveFrom: 'desc' },
        },
        statutoryProfile: true,
      },
    })

    if (!employees.length) {
      throw new ApiError(400, 'No active employees in scope for this company')
    }

    // Execute Payroll Run Orchestration in ONE atomic transaction
    const { run, linesCreated, recipients, skipped } = await db.$transaction(async (tx) => {
      // 1. Get or create default CompanyPayRule
      let payRule = await tx.companyPayRule.findUnique({
        where: { companyId: targetCompanyId },
      })
      if (!payRule) {
        payRule = await tx.companyPayRule.create({
          data: {
            companyId: targetCompanyId,
            workingDaysBasis: 'CALENDAR',
            otMultiplier: new Prisma.Decimal('1.50'),
            payrollCutoffDay: 25,
            currency: 'INR',
            timezone: 'Asia/Kolkata',
          },
        })
      }

      // 2. Create PayrollRun header in DRAFT status
      const payrollRun = await tx.payrollRun.create({
        data: {
          companyId: targetCompanyId,
          month,
          year,
          status: PAYROLL_STATUS.DRAFT,
          runById: auth.userId,
        },
      })

      const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
      const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

      let totalGross = new Prisma.Decimal('0.00')
      let totalDeductions = new Prisma.Decimal('0.00')
      let totalStatutory = new Prisma.Decimal('0.00')
      let totalNet = new Prisma.Decimal('0.00')

      const createdRecipients: Array<{ email: string; name: string; netPay: number }> = []
      const skippedEmployees: Array<{
        employeeId: string
        employeeCode: string
        employeeName: string
        reason: string
      }> = []
      let createdLinesCount = 0

      // 3. Process each employee through the pure calculation engine
      for (const emp of employees) {
        // Query employee attendances in month
        const attendances = await tx.attendance.findMany({
          where: {
            employeeId: emp.id,
            companyId: targetCompanyId,
            date: { gte: monthStart, lte: monthEnd },
          },
        })

        // Query employee approved leave requests in month
        const approvedLeaves = await tx.leaveRequest.findMany({
          where: {
            employeeId: emp.id,
            status: 'APPROVED',
            startDate: { lte: monthEnd },
            endDate: { gte: monthStart },
          },
          include: { leaveType: true },
        })

        let presentCount = 0
        let attendanceLopCount = 0
        let otHoursCount = 0

        for (const att of attendances) {
          if (att.status === 'PRESENT' || att.status === 'LATE' || att.status === 'WFH') {
            presentCount += 1
          } else if (att.status === 'HALF_DAY') {
            presentCount += 0.5
            attendanceLopCount += 0.5
          } else if (att.status === 'ABSENT') {
            attendanceLopCount += 1
          }

          if (att.checkIn && att.checkOut) {
            const diffMs = att.checkOut.getTime() - att.checkIn.getTime()
            const workedHours = diffMs / (1000 * 60 * 60)
            if (workedHours > 9) {
              otHoursCount += workedHours - 9
            }
          }
        }

        for (const leave of approvedLeaves) {
          const typeName = (leave.leaveType?.name || '').toLowerCase()
          if (typeName.includes('unpaid') || typeName.includes('lop') || typeName.includes('loss of pay')) {
            attendanceLopCount += leave.days
          }
        }

        // Upsert AttendanceSummary
        const summary = await tx.attendanceSummary.upsert({
          where: {
            employeeId_companyId_month_year: {
              employeeId: emp.id,
              companyId: targetCompanyId,
              month,
              year,
            },
          },
          create: {
            employeeId: emp.id,
            companyId: targetCompanyId,
            month,
            year,
            presentDays: new Prisma.Decimal(presentCount),
            lopDays: new Prisma.Decimal(attendanceLopCount),
            otHours: new Prisma.Decimal(otHoursCount),
          },
          update: {
            presentDays: new Prisma.Decimal(presentCount),
            lopDays: new Prisma.Decimal(attendanceLopCount),
            otHours: new Prisma.Decimal(otHoursCount),
          },
        })

        // Determine Indian Financial Year start and end for current run (month, year)
        const fyStartYear = month >= 4 ? year : year - 1
        const fyEndYear = fyStartYear + 1

        // Find prior lines in the same FY for this employee and company
        const priorLines = await tx.payrollLine.findMany({
          where: {
            employeeId: emp.id,
            run: {
              companyId: targetCompanyId,
              OR: [
                {
                  year: fyStartYear,
                  month: { gte: 4, ...(month >= 4 ? { lt: month } : {}) },
                },
                ...(month < 4
                  ? [
                      {
                        year: fyEndYear,
                        month: { lt: month },
                      },
                    ]
                  : []),
              ],
            },
          },
          select: { tds: true },
        })

        const previousTdsDeducted = priorLines.reduce(
          (sum, line) => sum.add(line.tds ?? new Prisma.Decimal('0.00')),
          new Prisma.Decimal('0.00')
        )

        let declaredDeductions: DeclaredDeductionsInput | null = null
        if (emp.statutoryProfile?.declarations) {
          try {
            declaredDeductions = JSON.parse(emp.statutoryProfile.declarations)
          } catch {
            declaredDeductions = null
          }
        }

        // Compute pure payslip draft via calculation engine (isolated per-employee)
        let draft: PayrollLineDraft
        try {
          draft = computePayslip({
            runId: payrollRun.id,
            companyId: targetCompanyId,
            month,
            year,
            employee: emp,
            payRule,
            summary,
            previousTdsDeducted,
            declaredDeductions,
          })
        } catch (err) {
          if (err instanceof PayrollCalculationError) {
            console.warn(`[PAYROLL_SKIP] Employee ${emp.employeeCode} skipped: ${err.message}`)
            skippedEmployees.push({
              employeeId: emp.id,
              employeeCode: emp.employeeCode,
              employeeName: emp.user?.name || 'Unknown',
              reason: err.message,
            })
            continue
          }
          // Any other error type must abort the transaction
          throw err
        }

        createdLinesCount++

        // Create PayrollLine
        await tx.payrollLine.create({
          data: {
            runId: payrollRun.id,
            employeeId: emp.id,
            gross: draft.gross,
            deductions: draft.deductions,
            statutory: draft.statutory,
            tds: draft.tds,
            net: draft.net,
            daysPaid: draft.daysPaid,
            lopDays: draft.lopDays,
            componentBreakdown: draft.componentBreakdown,
          },
        })

        // Upsert legacy Payroll record for backwards compatibility
        const basicAmount = draft.gross.greaterThan(draft.deductions)
          ? draft.gross.mul(new Prisma.Decimal('0.50')).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          : draft.gross
        const allowancesAmount = draft.gross.sub(basicAmount)

        await tx.payroll.upsert({
          where: {
            employeeId_month_year: {
              employeeId: emp.id,
              month,
              year,
            },
          },
          create: {
            employeeId: emp.id,
            month,
            year,
            basic: basicAmount,
            allowances: allowancesAmount,
            deductions: draft.deductions,
            netPay: draft.net,
            status: PAYROLL_STATUS.DRAFT,
            generatedById: auth.userId,
          },
          update: {
            basic: basicAmount,
            allowances: allowancesAmount,
            deductions: draft.deductions,
            netPay: draft.net,
          },
        })

        totalGross = totalGross.add(draft.gross)
        totalDeductions = totalDeductions.add(draft.deductions)
        totalStatutory = totalStatutory.add(draft.statutory)
        totalNet = totalNet.add(draft.net)

        // Internal notification
        await tx.notification.create({
          data: {
            userId: emp.userId,
            title: 'Payslip generated',
            message: `Payslip for ${month}/${year} is available.`,
            link: '/payroll',
          },
        })

        if (emp.user?.email) {
          createdRecipients.push({
            email: emp.user.email,
            name: emp.user.name || 'Employee',
            netPay: Number(draft.net.toFixed(2)),
          })
        }
      }

      // 4. Update PayrollRun header totals
      const updatedRun = await tx.payrollRun.update({
        where: { id: payrollRun.id },
        data: {
          totalGross,
          totalDeductions,
          totalStatutory,
          totalNet,
        },
      })

      // 5. Audit Log entry
      await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_GENERATE, 'PayrollRun', payrollRun.id, {
        companyId: targetCompanyId,
        month,
        year,
        linesCount: createdLinesCount,
        totalGross: totalGross.toString(),
        totalNet: totalNet.toString(),
        ...(skippedEmployees.length > 0 ? { skipped: skippedEmployees } : {}),
      })

      return {
        run: updatedRun,
        linesCreated: createdLinesCount,
        recipients: createdRecipients,
        skipped: skippedEmployees,
      }
    })

    // Transactional email notification outside DB transaction (no-op unless EMAIL_ENABLED=true)
    for (const recipient of recipients) {
      sendPayslipReadyEmail(recipient.email, {
        name: recipient.name,
        month,
        year,
        netPay: recipient.netPay,
        viewUrl: '/payroll',
      }).catch((err) => console.error('[EMAIL:PAYSLIP_ERROR]', err))
    }

    return Response.json({
      ok: true,
      data: {
        id: run.id,
        companyId: run.companyId,
        month: run.month,
        year: run.year,
        status: run.status,
        totalGross: Number(run.totalGross),
        totalDeductions: Number(run.totalDeductions),
        totalStatutory: Number(run.totalStatutory),
        totalNet: Number(run.totalNet),
        created: linesCreated,
        skipped: skipped,
      },
    })
  })
}

// PATCH /api/payroll?id=&runId= - update run or individual line (SUPER_ADMIN only)
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
    const runId = url.searchParams.get('runId')
    if (!id && !runId) {
      throw new ApiError(400, 'id or runId required')
    }

    const rawBody = await req.json().catch(() => ({}))
    const body = validateBody(payrollUpdateSchema, rawBody)

    // Step-up verification is MANDATORY for SUPER_ADMIN payroll mutations (BODY ONLY)
    // Passwords must NEVER travel in headers; x-step-up-email and x-step-up-password are rejected.
    const stepUpEmail = typeof rawBody.email === 'string' ? rawBody.email.trim() : (typeof body.email === 'string' ? body.email.trim() : '')
    const stepUpPassword = typeof rawBody.password === 'string' ? rawBody.password : ''

    if (!stepUpEmail || !stepUpPassword) {
      await logAudit(
        db,
        auth.userId,
        AUDIT_ACTIONS.STEP_UP_FAILURE,
        'Payroll',
        id || runId || 'unknown',
        { reason: 'Missing step-up credentials in request body' }
      ).catch(() => {})
      throw new ApiError(403, 'Forbidden: step-up authentication required (email and password must be provided in request body)')
    }

    await verifySuperadminStepUp(auth, stepUpEmail, stepUpPassword, req)

    const scopedIds = await getScopedCompanyIds(auth)

    // Case 1: Operating on PayrollRun
    const targetRunId = runId || (!id?.startsWith('line_') ? id : null)
    const existingRun = targetRunId
      ? await db.payrollRun.findUnique({
          where: { id: targetRunId },
          include: { lines: true },
        })
      : null

    if (existingRun) {
      if (scopedIds) {
        assertCompanyInScope(existingRun.companyId, scopedIds)
      }

      if (body.status !== undefined) {
        if (!PAYROLL_STATUSES.includes(body.status)) {
          throw new ApiError(400, 'Invalid payroll status')
        }
        validateAdjacentStatusTransition(existingRun.status, body.status)
      }

      const nextStatus = body.status ?? existingRun.status
      const { updatedRun, paidRecipients } = await db.$transaction(async (tx) => {
        const run = await tx.payrollRun.update({
          where: { id: existingRun.id },
          data: {
            status: nextStatus,
            lockedAt: nextStatus === PAYROLL_STATUS.LOCKED ? new Date() : existingRun.lockedAt,
            processedAt: nextStatus === PAYROLL_STATUS.PROCESSED ? new Date() : existingRun.processedAt,
            paidAt: nextStatus === PAYROLL_STATUS.PAID ? new Date() : existingRun.paidAt,
          },
        })

        // Synchronize legacy Payroll records for this run
        await tx.payroll.updateMany({
          where: {
            employee: { assignments: { some: { companyId: existingRun.companyId } } },
            month: existingRun.month,
            year: existingRun.year,
          },
          data: {
            status: nextStatus,
            paidAt: nextStatus === PAYROLL_STATUS.PAID ? new Date() : undefined,
          },
        })

        const paidRecipientsList: Array<{ email: string; name: string; netPay: number; id: string }> = []

        if (nextStatus === PAYROLL_STATUS.PAID && existingRun.status !== PAYROLL_STATUS.PAID) {
          const employeeIds = existingRun.lines.map((l) => l.employeeId)
          const employees = await tx.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true, userId: true, user: { select: { email: true, name: true } } },
          })
          for (const emp of employees) {
            await tx.notification.create({
              data: {
                userId: emp.userId,
                title: 'Salary paid',
                message: `Salary for ${existingRun.month}/${existingRun.year} has been paid.`,
                link: '/payroll',
              },
            })
          }
          for (const line of existingRun.lines) {
            const emp = employees.find((e) => e.id === line.employeeId)
            if (emp?.user?.email) {
              paidRecipientsList.push({
                email: emp.user.email,
                name: emp.user.name || 'Employee',
                netPay: Number(line.net),
                id: line.id,
              })
            }
          }

          await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_PAY, 'PayrollRun', existingRun.id, {
            month: existingRun.month,
            year: existingRun.year,
            totalNet: Number(existingRun.totalNet),
          })
        } else if (nextStatus === PAYROLL_STATUS.PROCESSED && existingRun.status !== PAYROLL_STATUS.PROCESSED) {
          await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_PROCESS, 'PayrollRun', existingRun.id, {
            month: existingRun.month,
            year: existingRun.year,
            totalNet: Number(existingRun.totalNet),
          })
        } else if (nextStatus === PAYROLL_STATUS.LOCKED && existingRun.status !== PAYROLL_STATUS.LOCKED) {
          await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_LOCK, 'PayrollRun', existingRun.id, {
            month: existingRun.month,
            year: existingRun.year,
          })
        }

        return { updatedRun: run, paidRecipients: paidRecipientsList }
      })

      // Queue payslipReady email on PAYROLL PAID transition (respects EMAIL_ENABLED inside mailer)
      for (const recipient of paidRecipients) {
        sendPayslipReadyEmail(recipient.email, {
          name: recipient.name,
          month: existingRun.month,
          year: existingRun.year,
          netPay: recipient.netPay,
          viewUrl: `/payroll/${recipient.id}/slip`,
        }).catch((err) => console.error('[EMAIL:PAYROLL_PAID_ERROR]', err))
      }

      return Response.json({
        ok: true,
        data: {
          ...updatedRun,
          totalGross: Number(updatedRun.totalGross),
          totalDeductions: Number(updatedRun.totalDeductions),
          totalStatutory: Number(updatedRun.totalStatutory),
          totalNet: Number(updatedRun.totalNet),
        },
      })
    }

    // Case 2: Operating on single legacy Payroll or PayrollLine record
    const targetId = id!
    const existing = await db.payroll.findUnique({
      where: { id: targetId },
      include: { employee: { include: { assignments: true } } },
    })

    if (!existing) {
      throw new ApiError(404, 'Payslip not found')
    }

    if (scopedIds) {
      const inScope = existing.employee.assignments.some((a) => scopedIds.includes(a.companyId))
      if (!inScope) {
        throw new ApiError(403, 'Forbidden: payslip out of scope')
      }
    }

    if (body.status !== undefined) {
      if (!PAYROLL_STATUSES.includes(body.status)) {
        throw new ApiError(400, 'Invalid payroll status')
      }
      validateAdjacentStatusTransition(existing.status, body.status)
    }

    const hasAmountEdit =
      body.basic != null ||
      body.allowances != null ||
      body.deductions != null ||
      body.gross != null ||
      body.net != null

    const basic = body.basic != null ? Number(body.basic) : Number(existing.basic)
    const allowances = body.allowances != null ? Number(body.allowances) : Number(existing.allowances)
    const deductions = body.deductions != null ? Number(body.deductions) : Number(existing.deductions)

    if (basic < 0 || allowances < 0 || deductions < 0 || isNaN(basic) || isNaN(allowances) || isNaN(deductions)) {
      throw new ApiError(400, 'Payroll amounts cannot be negative')
    }

    const netPay = basic + allowances - deductions
    const nextStatus = body.status ?? existing.status

    const { updatedRec, singlePaidRecipient } = await db.$transaction(async (tx) => {
      const rec = await tx.payroll.update({
        where: { id: targetId },
        data: {
          basic,
          allowances,
          deductions,
          netPay,
          status: nextStatus,
          paidAt: nextStatus === PAYROLL_STATUS.PAID ? new Date() : existing.paidAt,
        },
      })

      // Any manual amount edit writes an audit entry with before/after
      if (hasAmountEdit) {
        await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_MANUAL_EDIT, 'Payroll', targetId, {
          before: {
            basic: Number(existing.basic),
            allowances: Number(existing.allowances),
            deductions: Number(existing.deductions),
            netPay: Number(existing.netPay),
          },
          after: {
            basic,
            allowances,
            deductions,
            netPay,
          },
        })
      }

      let paidRecipient: { email: string; name: string; netPay: number; id: string } | null = null

      if (nextStatus === PAYROLL_STATUS.PAID && existing.status !== PAYROLL_STATUS.PAID) {
        const emp = await tx.employee.findUnique({
          where: { id: rec.employeeId },
          select: { userId: true, user: { select: { email: true, name: true } } },
        })

        if (emp?.userId) {
          await tx.notification.create({
            data: {
              userId: emp.userId,
              title: 'Salary paid',
              message: `Salary for ${rec.month}/${rec.year} has been paid.`,
              link: `/payroll/${rec.id}/slip`,
            },
          })
        }

        if (emp?.user?.email) {
          paidRecipient = {
            email: emp.user.email,
            name: emp.user.name || 'Employee',
            netPay: Number(rec.netPay),
            id: rec.id,
          }
        }

        await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_PAY, 'Payroll', targetId, {
          month: rec.month,
          year: rec.year,
          netPay: Number(rec.netPay),
        })
      } else if (nextStatus === PAYROLL_STATUS.PROCESSED && existing.status !== PAYROLL_STATUS.PROCESSED) {
        await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_PROCESS, 'Payroll', targetId, {
          month: rec.month,
          year: rec.year,
          netPay: Number(rec.netPay),
        })
      } else if (nextStatus === PAYROLL_STATUS.LOCKED && existing.status !== PAYROLL_STATUS.LOCKED) {
        await logAudit(tx, auth.userId, AUDIT_ACTIONS.PAYROLL_LOCK, 'Payroll', targetId, {
          month: rec.month,
          year: rec.year,
        })
      }

      return { updatedRec: rec, singlePaidRecipient: paidRecipient }
    })

    // Queue payslipReady email on single PAYROLL PAID transition (respects EMAIL_ENABLED)
    if (singlePaidRecipient) {
      sendPayslipReadyEmail(singlePaidRecipient.email, {
        name: singlePaidRecipient.name,
        month: updatedRec.month,
        year: updatedRec.year,
        netPay: singlePaidRecipient.netPay,
        viewUrl: `/payroll/${singlePaidRecipient.id}/slip`,
      }).catch((err) => console.error('[EMAIL:SINGLE_PAYROLL_PAID_ERROR]', err))
    }

    return Response.json({
      ok: true,
      data: {
        ...updatedRec,
        basic: Number(updatedRec.basic),
        allowances: Number(updatedRec.allowances),
        deductions: Number(updatedRec.deductions),
        netPay: Number(updatedRec.netPay),
      },
    })
  })
}
