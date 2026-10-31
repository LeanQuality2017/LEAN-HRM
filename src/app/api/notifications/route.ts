import { db } from '@/lib/db'
import { requireAuth, handle, ApiError } from '@/lib/api-auth'
import { validateBody, notificationPatchSchema } from '@/lib/validation'
import { parsePaginationParams } from '@/lib/pagination'

// GET /api/notifications — my notifications
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const { page, pageSize, skip } = parsePaginationParams(url)
    const where = { userId: auth.userId }

    const [total, data] = await Promise.all([
      db.notification.count({ where }),
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ])

    return Response.json({ ok: true, data, page, pageSize, total })
  })
}

// PATCH /api/notifications?id= | all=true — mark read
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const body = validateBody(notificationPatchSchema, await req.json())
    if (body.all) {
      await db.notification.updateMany({ where: { userId: auth.userId, isRead: false }, data: { isRead: true } })
    } else {
      if (!body.id) throw new ApiError(400, 'id required')
      await db.notification.updateMany({ where: { id: body.id, userId: auth.userId }, data: { isRead: true } })
    }
    return Response.json({ ok: true })
  })
}
