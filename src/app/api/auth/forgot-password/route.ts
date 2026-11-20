import { randomBytes, createHash } from 'crypto'
import { db } from '@/lib/db'
import { handle, ApiError } from '@/lib/api-auth'
import { validateBody, forgotPasswordSchema } from '@/lib/validation'
import { buildRateLimitKey, isLoginRateLimited, recordFailedLogin, getClientIp } from '@/lib/rate-limit'
import { sendPasswordResetEmail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'

// POST /api/auth/forgot-password
// Generic success response to prevent account enumeration
export async function POST(req: Request) {
  return handle(async () => {
    const rawIp = getClientIp(req)
    const json = await req.json().catch(() => ({}))
    const body = validateBody(forgotPasswordSchema, json)
    const email = body.email.toLowerCase().trim()

    // Rate limit checks based on email + client IP
    const rateKey = buildRateLimitKey(email, rawIp)
    if (isLoginRateLimited(rateKey)) {
      throw new ApiError(429, 'Too many requests, try again later')
    }

    const genericSuccess = {
      ok: true,
      message: 'If an account with that email exists, password reset instructions have been sent.',
    }

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, isActive: true },
    })

    // If user does not exist or is inactive, record attempt and return generic success
    if (!user || !user.isActive) {
      recordFailedLogin(rateKey)
      return Response.json(genericSuccess)
    }

    // Invalidate any previous unused password reset tokens for this user
    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    // Generate cryptographically secure random token & SHA-256 hash for storage
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes

    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    })

    // Build reset URL
    const origin = req.headers.get('origin') || process.env.NEXTAUTH_URL || 'http://localhost:3001'
    const resetUrl = `${origin.replace(/\/+$/, '')}/reset-password?token=${rawToken}`

    // Dispatch transactional email (no-op in dev/CI unless EMAIL_ENABLED=true)
    await sendPasswordResetEmail(user.email, {
      name: user.name || 'User',
      resetUrl,
      expiresInMinutes: 30,
    })

    // Log security audit record
    await logAudit(db, user.id, 'REQUEST_PASSWORD_RESET', 'User', user.id, {
      ip: rawIp,
      expiresAt: expiresAt.toISOString(),
    })

    return Response.json(genericSuccess)
  })
}

