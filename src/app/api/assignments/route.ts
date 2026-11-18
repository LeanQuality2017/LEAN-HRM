import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, assignmentCreateSchema, assignmentUpdateSchema } from '@/lib/validation'

// POST /api/assignments - assign employee to company (Admin only)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN'])
    const body = validateBody(assignmentCreateSchema, await req.json())
    const { employeeId, companyId, isPrimary, designation } = body

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(companyId, scopedIds)

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      include: { assignments: true },
    })
    if (!employee) throw new ApiError(404, 'Employee not found')

    // Authority over the employee: Caller must administer at least one of the employee's current companies
    if (scopedIds !== null && employee.assignments.length > 0) {
      const hasAuthorityOverEmployee = employee.assignments.some((a) => scopedIds.includes(a.companyId))
      if (!hasAuthorityOverEmployee) {
        throw new ApiError(403, 'Forbidden: cannot assign employee without administrative authority over that employee')
      }
    }

    // Protection of other companies' primary assignment:
    // Changing an employee's primary assignment away from another company requires authority over the existing primary company
    if (isPrimary && scopedIds !== null) {
      const currentPrimary = employee.assignments.find((a) => a.isPrimary)
      if (currentPrimary && currentPrimary.companyId !== companyId) {
        if (!scopedIds.includes(currentPrimary.companyId)) {
          throw new ApiError(
            403,
            'Forbidden: cannot change primary assignment belonging to another company without administrative authority over that company'
          )
        }
      }
    }

    const company = await db.company.findUnique({ where: { id: companyId } })
    if (!company) throw new ApiError(404, 'Company not found')

    const assignment = await db.$transaction(async (tx) => {
      // If setting as primary, clear other primary flags for this employee
      if (isPrimary) {
        await tx.employeeCompanyAssignment.updateMany({
          where: { employeeId },
          data: { isPrimary: false },
        })
      }

      const res = await tx.employeeCompanyAssignment.upsert({
        where: {
          employeeId_companyId: {
            employeeId,
            companyId,
          },
        },
        create: {
          employeeId,
          companyId,
          isPrimary: isPrimary !== undefined ? Boolean(isPrimary) : false,
          designation: designation?.trim() || employee.designation,
        },
        update: {
          isPrimary: isPrimary !== undefined ? Boolean(isPrimary) : undefined,
          designation: designation?.trim() || undefined,
        },
      })

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.EMPLOYEE_ASSIGN, 'EmployeeCompanyAssignment', res.id, {
        employeeId,
        companyId,
        isPrimary: Boolean(isPrimary),
      })

      return res
    })

    return Response.json({ ok: true, data: assignment }, { status: 201 })
  })
}

// PATCH /api/assignments - update assignment (Admin only)
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN'])
    const body = validateBody(assignmentUpdateSchema, await req.json())
    const { id, employeeId, companyId, isPrimary, designation } = body

    let assignment: any = null
    const includeQuery = { employee: { include: { assignments: true } } }
    if (id) {
      assignment = await db.employeeCompanyAssignment.findUnique({ where: { id }, include: includeQuery })
    } else if (employeeId && companyId) {
      assignment = await db.employeeCompanyAssignment.findUnique({
        where: { employeeId_companyId: { employeeId, companyId } },
        include: includeQuery,
      })
    }

    if (!assignment) throw new ApiError(404, 'Assignment not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(assignment.companyId, scopedIds)

    // Protection of other companies' primary assignment:
    // Changing an assignment to primary when another company currently holds primary requires authority over that company
    if (isPrimary && scopedIds !== null) {
      const currentPrimary = assignment.employee.assignments.find((a: any) => a.isPrimary && a.id !== assignment.id)
      if (currentPrimary && currentPrimary.companyId !== assignment.companyId) {
        if (!scopedIds.includes(currentPrimary.companyId)) {
          throw new ApiError(
            403,
            'Forbidden: cannot change primary assignment belonging to another company without administrative authority over that company'
          )
        }
      }
    }

    const updated = await db.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.employeeCompanyAssignment.updateMany({
          where: { employeeId: assignment.employeeId },
          data: { isPrimary: false },
        })
      }

      return tx.employeeCompanyAssignment.update({
        where: { id: assignment.id },
        data: {
          isPrimary: isPrimary !== undefined ? Boolean(isPrimary) : undefined,
          designation: designation?.trim() || undefined,
        },
      })
    })

    return Response.json({ ok: true, data: updated })
  })
}

// DELETE /api/assignments - unassign employee from company (Admin only)
export async function DELETE(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN'])
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const employeeId = url.searchParams.get('employeeId')
    const companyId = url.searchParams.get('companyId')

    let assignment: any = null
    if (id) {
      assignment = await db.employeeCompanyAssignment.findUnique({ where: { id } })
    } else if (employeeId && companyId) {
      assignment = await db.employeeCompanyAssignment.findUnique({
        where: { employeeId_companyId: { employeeId, companyId } },
      })
    }

    if (!assignment) throw new ApiError(404, 'Assignment not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(assignment.companyId, scopedIds)

    await db.$transaction(async (tx) => {
      await tx.employeeCompanyAssignment.delete({ where: { id: assignment.id } })

      // If unassigned assignment was primary, promote another remaining assignment to primary
      if (assignment.isPrimary) {
        const remaining = await tx.employeeCompanyAssignment.findFirst({
          where: { employeeId: assignment.employeeId },
        })
        if (remaining) {
          await tx.employeeCompanyAssignment.update({
            where: { id: remaining.id },
            data: { isPrimary: true },
          })
        }
      }

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.EMPLOYEE_UNASSIGN, 'EmployeeCompanyAssignment', assignment.id, {
        employeeId: assignment.employeeId,
        companyId: assignment.companyId,
      })
    })

    return Response.json({ ok: true })
  })
}
