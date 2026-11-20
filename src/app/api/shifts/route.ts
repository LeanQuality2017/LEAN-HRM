import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES, STAFF_ROLES, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, shiftCreateSchema } from '@/lib/validation'

// GET /api/shifts - list shifts (scoped to accessible companies)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(STAFF_ROLES)
    const url = new URL(req.url)
    const companyId = url.searchParams.get('companyId') || undefined
    const scopedIds = await getScopedCompanyIds(auth)

    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Record<string, unknown> = {}
    if (companyId) {
      where.companyId = companyId
    } else if (scopedIds !== null) {
      where.companyId = { in: scopedIds }
    }

    const data = await db.shift.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    })

    return Response.json({ ok: true, data })
  })
}

// POST /api/shifts - create shift
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const body = validateBody(shiftCreateSchema, await req.json())
    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(body.companyId, scopedIds)

    const company = await db.company.findUnique({
      where: { id: body.companyId },
    })
    if (!company) throw new ApiError(404, 'Company not found')

    const exists = await db.shift.findUnique({
      where: {
        companyId_name: {
          companyId: body.companyId,
          name: body.name.trim(),
        },
      },
    })
    if (exists) throw new ApiError(409, 'A shift with this name already exists for this company')

    const shift = await db.$transaction(async (tx) => {
      // Enforce exactly one isDefault shift per company
      if (body.isDefault) {
        await tx.shift.updateMany({
          where: { companyId: body.companyId, isDefault: true },
          data: { isDefault: false },
        })
      }

      const created = await tx.shift.create({
        data: {
          companyId: body.companyId,
          name: body.name.trim(),
          startTime: body.startTime,
          endTime: body.endTime,
          breakMinutes: body.breakMinutes,
          graceMinutes: body.graceMinutes,
          isDefault: body.isDefault,
          weekoffMultiplier: body.weekoffMultiplier,
        },
      })

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.SHIFT_CREATE, 'Shift', created.id, {
        companyId: body.companyId,
        name: created.name,
        isDefault: created.isDefault,
      })

      return created
    })

    return Response.json({ ok: true, data: shift }, { status: 201 })
  })
}

