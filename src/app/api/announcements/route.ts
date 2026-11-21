import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { MANAGEMENT_ROLES } from '@/lib/constants'
import { validateBody, announcementCreateSchema } from '@/lib/validation'

// GET /api/announcements - list announcements visible to caller
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const companyId = url.searchParams.get('companyId')

    const scopedIds = await getScopedCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Prisma.AnnouncementWhereInput = {}
    if (companyId) {
      where.companyId = companyId
    } else if (scopedIds) {
      where.OR = [
        { companyId: null },
        { companyId: { in: scopedIds } },
      ]
    }

    const data = await db.announcement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        company: { select: { name: true, code: true } },
        createdBy: { select: { name: true } },
      },
    })
    return Response.json({ ok: true, data })
  })
}

// POST /api/announcements - post announcement (optionally company-scoped)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(MANAGEMENT_ROLES)
    const body = validateBody(announcementCreateSchema, await req.json())

    const scopedIds = await getScopedCompanyIds(auth)
    if (body.companyId) {
      assertCompanyInScope(body.companyId, scopedIds)
    } else if (auth.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'Forbidden: companyId required for company administrators')
    }

    const ann = await db.announcement.create({
      data: { title: body.title, content: body.content, companyId: body.companyId || null, createdById: auth.userId },
    })

    // notify relevant users
    const users = body.companyId
      ? await db.user.findMany({ where: { isActive: true, employee: { assignments: { some: { companyId: body.companyId } } } }, select: { id: true } })
      : await db.user.findMany({ where: { isActive: true, role: { not: 'STUDENT' } }, select: { id: true } })
    if (users.length) {
      await db.notification.createMany({ data: users.map((u) => ({ userId: u.id, title: `📢 ${body.title}`, message: body.content.slice(0, 120), link: '/announcements' })) })
    }
    return Response.json({ ok: true, data: ann })
  })
}
