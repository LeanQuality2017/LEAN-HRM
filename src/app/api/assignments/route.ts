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

    const employee = await db.employee.findUnique({ where: { id: employeeId } })
    if (!employee) throw new ApiError(404, 'Employee not found')

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

    if (isPrimary) {
      await db.employeeCompanyAssignment.updateMany({
        where: { employeeId: assignment.employeeId },
        data: { isPrimary: false },
      })
    }

    const updated = await db.employeeCompanyAssignment.update({
      where: { id: assignment.id },
      data: {
        isPrimary: isPrimary !== undefined ? Boolean(isPrimary) : undefined,
        designation: designation?.trim() || undefined,
      },
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
