import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds } from '@/lib/api-auth'
import { hashPassword } from '@/lib/password'
import { AUDIT_ACTIONS, ROLES } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, userResetPasswordSchema } from '@/lib/validation'

// POST /api/users/reset-password - administrative password reset
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth([ROLES.SUPER_ADMIN])
    const body = validateBody(userResetPasswordSchema, await req.json())

    const targetUser = await db.user.findUnique({
      where: { id: body.userId },
      include: {
        employee: { include: { assignments: true } },
        companyScopes: true,
      },
    })
    if (!targetUser) throw new ApiError(404, 'User not found')

    // Self-reset must be performed via change-password with step-up verification
    if (auth.userId === targetUser.id) {
      throw new ApiError(400, 'Self-password update must use the change-password endpoint with current password verification')
    }

    // Neither SUPER_ADMIN nor COMPANY_ADMIN can reset a SUPER_ADMIN account via this endpoint
    if (targetUser.role === ROLES.SUPER_ADMIN) {
      throw new ApiError(403, 'Forbidden: Cannot reset Super Admin password')
    }

    // COMPANY_ADMIN can only reset strictly subordinate non-peer accounts fully within own scope
    if (auth.role === ROLES.COMPANY_ADMIN) {
      // Peer protection: Company Admin cannot reset peer Company Admins
      if (targetUser.role === ROLES.COMPANY_ADMIN) {
        throw new ApiError(403, 'Forbidden: Company Admin cannot reset passwords for peer Company Admins')
      }

      const scopedIds = await getScopedCompanyIds(auth)
      if (!scopedIds || scopedIds.length === 0) {
        throw new ApiError(403, 'Forbidden: No administrative company scope')
      }

      // Collect all companies associated with target user
      const targetAssignmentCids = targetUser.employee?.assignments?.map((a) => a.companyId) ?? []
      const targetScopeCids = targetUser.companyScopes?.map((s) => s.companyId) ?? []
      const allTargetCids = Array.from(new Set([...targetAssignmentCids, ...targetScopeCids]))

      if (allTargetCids.length === 0) {
        throw new ApiError(403, 'Forbidden: Target user has no company scope within your administrative authority')
      }

      // Cross-scope protection: If target user belongs to ANY company outside caller's authority, deny
      const hasOutsideScope = allTargetCids.some((cid) => !scopedIds.includes(cid))
      if (hasOutsideScope) {
        throw new ApiError(403, 'Forbidden: Cannot reset passwords for cross-scope accounts without central identity authority')
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

