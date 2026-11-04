import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds } from '@/lib/api-auth'
import { ROLES, AUDIT_ACTIONS } from '@/lib/constants'
import { hashPassword } from '@/lib/password'
import { logAudit } from '@/lib/audit'
import { validateBody, companyCreateSchema, companyUpdateSchema } from '@/lib/validation'

// GET /api/companies - list companies (scoped to user)
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth()
    const scopedIds = await getScopedCompanyIds(auth)
    const where = scopedIds ? { id: { in: scopedIds } } : {}
    const data = await db.company.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    })
    return Response.json({ ok: true, data })
  })
}

// POST /api/companies - create company + its admin (SUPER_ADMIN only)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth([ROLES.SUPER_ADMIN])
    const body = validateBody(companyCreateSchema, await req.json())
    const nameExists = await db.company.findFirst({
      where: { name: { equals: body.name.trim(), mode: 'insensitive' } },
    })
    if (nameExists) throw new ApiError(409, 'A company with this name already exists.')

    const exists = await db.company.findUnique({ where: { code: body.code.toUpperCase() } })
    if (exists) throw new ApiError(409, 'Company code already exists')

    const company = await db.$transaction(async (tx) => {
      const createdCompany = await tx.company.create({
        data: {
          name: body.name,
          code: body.code.toUpperCase(),
          type: body.type ?? 'NORMAL',
          address: body.address ?? null,
          phone: body.phone ?? null,
          email: body.email ?? null,
        },
      })

      await tx.leaveType.createMany({
        data: [
          { companyId: createdCompany.id, name: 'Casual Leave', daysPerYear: 12 },
          { companyId: createdCompany.id, name: 'Sick Leave', daysPerYear: 8 },
        ],
      })

      // optional initial admin account
      if (body.adminEmail && body.adminPassword) {
        const email = body.adminEmail.toLowerCase().trim()
        const exists = await tx.user.findUnique({ where: { email } })
        if (exists) throw new ApiError(409, 'Admin email already in use')
        const user = await tx.user.create({
          data: {
            email,
            name: body.adminName || `${createdCompany.name} Admin`,
            role: ROLES.COMPANY_ADMIN,
            passwordHash: hashPassword(body.adminPassword),
          },
        })
        await tx.userCompanyScope.create({
          data: {
            userId: user.id,
            companyId: createdCompany.id,
          },
        })
      }

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.COMPANY_CREATE, 'Company', createdCompany.id, {
        name: createdCompany.name,
        code: createdCompany.code,
        type: createdCompany.type,
      })

      return createdCompany
    })

    return Response.json({ ok: true, data: company })
  })
}

// PATCH /api/companies?id= - update company (SUPER_ADMIN only)
export async function PATCH(req: Request) {
  return handle(async () => {
    await requireAuth([ROLES.SUPER_ADMIN])
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(companyUpdateSchema, await req.json())
    const company = await db.company.update({
      where: { id },
      data: { name: body.name ?? undefined, type: body.type ?? undefined, address: body.address ?? undefined, phone: body.phone ?? undefined, email: body.email ?? undefined, isActive: body.isActive ?? undefined },
    })
    return Response.json({ ok: true, data: company })
  })
}
