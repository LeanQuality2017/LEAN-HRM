import { db } from '@/lib/db'
import { requireAuth, handle, ApiError } from '@/lib/api-auth'
import { hashPassword, verifyPassword } from '@/lib/password'
import { AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, changePasswordSchema } from '@/lib/validation'

// POST /api/auth/change-password - authenticated user password change
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const body = validateBody(changePasswordSchema, await req.json())

    const user = await db.user.findUnique({ where: { id: auth.userId } })
    if (!user) throw new ApiError(404, 'User not found')

    const isValid = verifyPassword(body.currentPassword, user.passwordHash)
    if (!isValid) {
      throw new ApiError(400, 'Current password is incorrect')
    }

    const passwordHash = hashPassword(body.newPassword)

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      })

      await logAudit(tx, user.id, AUDIT_ACTIONS.PASSWORD_CHANGE, 'User', user.id, {
        email: user.email,
      })
    })

    return Response.json({ ok: true, message: 'Password changed successfully' })
  })
}

