import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES, STAFF_ROLES, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, holidayUpdateSchema } from '@/lib/validation'

// GET /api/holidays/[id] - get holiday details
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(STAFF_ROLES)
    const { id } = await params
    if (!id) throw new ApiError(400, 'id required')

    const holiday = await db.holiday.findUnique({
      where: { id },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
      },
    })
    if (!holiday) throw new ApiError(404, 'Holiday not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(holiday.companyId, scopedIds)

    return Response.json({ ok: true, data: holiday })
  })
}

// PATCH /api/holidays/[id] - update holiday
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const { id } = await params
    if (!id) throw new ApiError(400, 'id required')

    const existing = await db.holiday.findUnique({
      where: { id },
    })
    if (!existing) throw new ApiError(404, 'Holiday not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(existing.companyId, scopedIds)

    const body = validateBody(holidayUpdateSchema, await req.json())

    let newDate: Date | undefined
    if (body.date) {
      const dateKey = body.date.split('T')[0]
      newDate = new Date(`${dateKey}T00:00:00.000Z`)

      const conflict = await db.holiday.findUnique({
        where: {
          companyId_date: {
            companyId: existing.companyId,
            date: newDate,
          },
        },
      })
      if (conflict && conflict.id !== id) {
        throw new ApiError(409, 'A holiday already exists for this date')
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const res = await tx.holiday.update({
        where: { id },
        data: {
          date: newDate,
          name: body.name?.trim(),
          isOptional: body.isOptional,
        },
      })

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.HOLIDAY_UPDATE, 'Holiday', id, {
        companyId: existing.companyId,
        changes: body,
      })

      return res
    })

    return Response.json({ ok: true, data: updated })
  })
}

// DELETE /api/holidays/[id] - delete holiday
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const { id } = await params
    if (!id) throw new ApiError(400, 'id required')

    const existing = await db.holiday.findUnique({
      where: { id },
    })
    if (!existing) throw new ApiError(404, 'Holiday not found')

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(existing.companyId, scopedIds)

    await db.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } })
      await logAudit(tx, auth.userId, AUDIT_ACTIONS.HOLIDAY_DELETE, 'Holiday', id, {
        companyId: existing.companyId,
        name: existing.name,
      })
    })

    return Response.json({ ok: true, message: 'Holiday deleted' })
  })
}

