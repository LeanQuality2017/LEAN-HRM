import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { handle, ApiError } from '@/lib/api-auth'
import { validateBody, resetPasswordSchema } from '@/lib/validation'
import { hashPassword } from '@/lib/password'
import { resetLoginRateLimitForEmail } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'

// POST /api/auth/reset-password
// Verifies SHA-256 token hash, enforces password rules, updates hash, marks token used
export async function POST(req: Request) {
  return handle(async () => {
    const json = await req.json().catch(() => ({}))
    const body = validateBody(resetPasswordSchema, json)

    // Compute SHA-256 hash of the incoming raw token
    const tokenHash = createHash('sha256').update(body.token).digest('hex')

    const resetToken = await db.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            isActive: true,
          },
        },
      },
    })

    // Token must exist, not be expired, and not be previously used
    if (!resetToken || resetToken.usedAt !== null || resetToken.expiresAt < new Date()) {
      throw new ApiError(400, 'Invalid or expired password reset link. Please request a new one.')
    }

    if (!resetToken.user || !resetToken.user.isActive) {
      throw new ApiError(400, 'Account is inactive or not found.')
    }

    const newHashedPassword = hashPassword(body.newPassword)

    await db.$transaction(async (tx) => {
      // Update password
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash: newHashedPassword },
      })

      // Mark this token used
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      })

      // Invalidate all other active tokens for this user
      await tx.passwordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          usedAt: null,
        },
        data: { usedAt: new Date() },
      })

      // Audit log the password reset
      await logAudit(tx, resetToken.userId, 'RESET_PASSWORD', 'User', resetToken.userId, {
        method: 'SELF_SERVICE_TOKEN',
      })
    })

    // Clear any rate limits on this user's email
    resetLoginRateLimitForEmail(resetToken.user.email)

    return Response.json({
      ok: true,
      message: 'Password has been successfully reset. Please log in with your new password.',
    })
  })
}
