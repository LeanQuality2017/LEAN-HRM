import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES, STAFF_ROLES, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, holidayCreateSchema } from '@/lib/validation'

// GET /api/holidays - list holidays (scoped, filtered by companyId and/or year)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(STAFF_ROLES)
    const url = new URL(req.url)
    const companyId = url.searchParams.get('companyId') || undefined
    const yearStr = url.searchParams.get('year')
    const scopedIds = await getScopedCompanyIds(auth)

    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Prisma.HolidayWhereInput = {}
    if (companyId) {
      where.companyId = companyId
    } else if (scopedIds !== null) {
      where.companyId = { in: scopedIds }
    }

    if (yearStr) {
      const year = parseInt(yearStr, 10)
      if (isNaN(year) || year < 1900 || year > 2200) {
        throw new ApiError(400, 'Invalid year parameter')
      }
      const startOfYear = new Date(Date.UTC(year, 0, 1, 0, 0, 0))
      const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
      where.date = { gte: startOfYear, lte: endOfYear }
    }

    const data = await db.holiday.findMany({
      where,
      orderBy: { date: 'asc' },
    })

    return Response.json({ ok: true, data })
  })
}

// POST /api/holidays - create holiday
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const body = validateBody(holidayCreateSchema, await req.json())
    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(body.companyId, scopedIds)

    const company = await db.company.findUnique({
      where: { id: body.companyId },
    })
    if (!company) throw new ApiError(404, 'Company not found')

    const dateKey = body.date.split('T')[0]
    const holidayDate = new Date(`${dateKey}T00:00:00.000Z`)

    const exists = await db.holiday.findUnique({
      where: {
        companyId_date: {
          companyId: body.companyId,
          date: holidayDate,
        },
      },
    })
    if (exists) throw new ApiError(409, 'A holiday already exists for this date')

    const holiday = await db.$transaction(async (tx) => {
      const created = await tx.holiday.create({
        data: {
          companyId: body.companyId,
          date: holidayDate,
          name: body.name.trim(),
          isOptional: body.isOptional ?? false,
        },
      })

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.HOLIDAY_CREATE, 'Holiday', created.id, {
        companyId: body.companyId,
        name: created.name,
        date: dateKey,
      })

      return created
    })

    return Response.json({ ok: true, data: holiday }, { status: 201 })
  })
}

