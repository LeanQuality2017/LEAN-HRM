import { db } from '@/lib/db'
import { requireAuth, handle, ApiError } from '@/lib/api-auth'
import { hashPassword, verifyPassword } from '@/lib/password'
import { validateBody, profileUpdateSchema } from '@/lib/validation'

// PATCH /api/profile - self-service: update own name/phone/password
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const body = validateBody(profileUpdateSchema, await req.json())
    const user = await db.user.findUnique({ where: { id: auth.userId } })
    if (!user) throw new ApiError(404, 'User not found')

    const data: Record<string, unknown> = {}
    if (body.name) data.name = body.name
    if (body.phone !== undefined) data.phone = body.phone
    if (body.newPassword) {
      if (!body.currentPassword || !verifyPassword(body.currentPassword, user.passwordHash)) {
        throw new ApiError(400, 'Current password is incorrect')
      }
      data.passwordHash = hashPassword(body.newPassword)
    }
    if (!Object.keys(data).length) throw new ApiError(400, 'Nothing to update')

    await db.user.update({ where: { id: auth.userId }, data })
    return Response.json({ ok: true })
  })
}
