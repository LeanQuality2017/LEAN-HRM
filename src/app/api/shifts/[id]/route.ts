import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES, STAFF_ROLES, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, shiftUpdateSchema } from '@/lib/validation'

// GET /api/shifts/[id] - get shift details
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(STAFF_ROLES)
    const { id } = await params
    if (!id) throw new ApiError(400, 'id required')

    const shift = await db.shift.findUnique({
      where: { id },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
      },
    })
    if (!shift) throw new ApiError(404, 'Shift not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(shift.companyId, scopedIds)

    return Response.json({ ok: true, data: shift })
  })
}

// PATCH /api/shifts/[id] - update shift
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const { id } = await params
    if (!id) throw new ApiError(400, 'id required')

    const existing = await db.shift.findUnique({
      where: { id },
    })
    if (!existing) throw new ApiError(404, 'Shift not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(existing.companyId, scopedIds)

    const body = validateBody(shiftUpdateSchema, await req.json())

    // If name is changing, check uniqueness within company
    if (body.name && body.name.trim() !== existing.name) {
      const nameConflict = await db.shift.findUnique({
        where: {
          companyId_name: {
            companyId: existing.companyId,
            name: body.name.trim(),
          },
        },
      })
      if (nameConflict) throw new ApiError(409, 'A shift with this name already exists for this company')
    }

    // Check startTime !== endTime against merged values
    const mergedStart = body.startTime ?? existing.startTime
    const mergedEnd = body.endTime ?? existing.endTime
    if (mergedStart === mergedEnd) {
      throw new ApiError(400, 'endTime cannot be equal to startTime')
    }

    const updated = await db.$transaction(async (tx) => {
      // Enforce exactly one isDefault shift per company
      if (body.isDefault === true) {
        await tx.shift.updateMany({
          where: { companyId: existing.companyId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        })
      }

      const res = await tx.shift.update({
        where: { id },
        data: {
          name: body.name?.trim(),
          startTime: body.startTime,
          endTime: body.endTime,
          breakMinutes: body.breakMinutes,
          graceMinutes: body.graceMinutes,
          isDefault: body.isDefault,
          weekoffMultiplier: body.weekoffMultiplier,
        },
      })

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.SHIFT_UPDATE, 'Shift', id, {
        companyId: existing.companyId,
        changes: body,
      })

      return res
    })

    return Response.json({ ok: true, data: updated })
  })
}

// DELETE /api/shifts/[id] - delete shift (fails with 400 if referenced by any assignment)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const { id } = await params
    if (!id) throw new ApiError(400, 'id required')

    const existing = await db.shift.findUnique({
      where: { id },
    })
    if (!existing) throw new ApiError(404, 'Shift not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(existing.companyId, scopedIds)

    // Enforce referential integrity: reject delete if any assignments reference this shift
    const assignmentCount = await db.employeeShiftAssignment.count({
      where: { shiftId: id },
    })
    if (assignmentCount > 0) {
      throw new ApiError(400, 'Cannot delete shift: it is assigned to employees')
    }

    await db.$transaction(async (tx) => {
      await tx.shift.delete({ where: { id } })
      await logAudit(tx, auth.userId, AUDIT_ACTIONS.SHIFT_DELETE, 'Shift', id, {
        companyId: existing.companyId,
        name: existing.name,
      })
    })

    return Response.json({ ok: true, message: 'Shift deleted' })
  })
}

