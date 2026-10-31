import { db } from '@/lib/db'
import { requireAuth, handle, getScopedCompanyIds } from '@/lib/api-auth'
import { HR_ROLES, ROLES } from '@/lib/constants'
import { parsePaginationParams } from '@/lib/pagination'

// GET /api/audit - list latest audit log events (HR_ROLES only: SUPER_ADMIN, COMPANY_ADMIN, HR)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const url = new URL(req.url)
    const userId = url.searchParams.get('userId')
    const action = url.searchParams.get('action')

    const where: Record<string, unknown> = {}

    if (auth.role === ROLES.COMPANY_ADMIN || auth.role === ROLES.HR) {
      const scopedIds = await getScopedCompanyIds(auth)
      if (scopedIds && scopedIds.length) {
        where.OR = [
          { userId: auth.userId },
          { user: { employee: { assignments: { some: { companyId: { in: scopedIds } } } } } },
          { user: { companyScopes: { some: { companyId: { in: scopedIds } } } } },
        ]
      } else {
        where.userId = auth.userId
      }
    }

    if (userId) {
      where.userId = userId
    }
    if (action) {
      where.action = action
    }

    const { page, pageSize, skip } = parsePaginationParams(url)

    const [total, data] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      }),
    ])

    return Response.json({ ok: true, data, page, pageSize, total })
  })
}

