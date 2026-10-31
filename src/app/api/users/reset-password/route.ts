import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds } from '@/lib/api-auth'
import { hashPassword } from '@/lib/password'
import { ADMIN_ROLES, AUDIT_ACTIONS, ROLES } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, userResetPasswordSchema } from '@/lib/validation'

// POST /api/users/reset-password - administrative password reset
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(ADMIN_ROLES)
    const body = validateBody(userResetPasswordSchema, await req.json())

    const targetUser = await db.user.findUnique({
      where: { id: body.userId },
      include: {
        employee: { include: { assignments: true } },
        companyScopes: true,
      },
    })
    if (!targetUser) throw new ApiError(404, 'User not found')

    // Neither SUPER_ADMIN nor COMPANY_ADMIN can reset a SUPER_ADMIN account via this endpoint
    if (targetUser.role === ROLES.SUPER_ADMIN) {
      throw new ApiError(403, 'Forbidden: Cannot reset Super Admin password')
    }

    // COMPANY_ADMIN can only reset passwords for users within their own company scope
    if (auth.role === ROLES.COMPANY_ADMIN) {
      const scopedIds = await getScopedCompanyIds(auth)
      let inScope = false

      if (scopedIds && scopedIds.length) {
        const hasAssignment = targetUser.employee?.assignments?.some((a) =>
          scopedIds.includes(a.companyId)
        )
        const hasScope = targetUser.companyScopes?.some((s) =>
          scopedIds.includes(s.companyId)
        )
        inScope = Boolean(hasAssignment || hasScope)
      }

      if (!inScope) {
        throw new ApiError(403, 'Forbidden: User out of company scope')
      }
    }

    const passwordHash = hashPassword(body.newPassword)

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUser.id },
        data: { passwordHash },
      })

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.PASSWORD_RESET, 'User', targetUser.id, {
        email: targetUser.email,
        role: targetUser.role,
      })
    })

    return Response.json({ ok: true, message: 'Password reset successfully' })
  })
}

