// UniHR Login Rate Limiter (in-memory Map)
// Max 5 failed attempts per email + IP per rolling 15 minutes

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILED_ATTEMPTS = 5

interface RateLimitRecord {
  count: number
  resetTime: number
}

// Preserve rate limit map across HMR in development
const globalForRateLimit = globalThis as unknown as {
  loginRateLimitMap?: Map<string, RateLimitRecord>
}

export const loginRateLimitMap =
  globalForRateLimit.loginRateLimitMap || new Map<string, RateLimitRecord>()

if (process.env.NODE_ENV !== 'production') {
  globalForRateLimit.loginRateLimitMap = loginRateLimitMap
}

export function buildRateLimitKey(email: string, ip: string): string {
  return `${email.toLowerCase().trim()}:${ip.trim() || '127.0.0.1'}`
}

export function isLoginRateLimited(key: string): boolean {
  const now = Date.now()
  const record = loginRateLimitMap.get(key)
  if (!record) return false

  // If window has passed, clear expired record
  if (now > record.resetTime) {
    loginRateLimitMap.delete(key)
    return false
  }

  return record.count >= MAX_FAILED_ATTEMPTS
}

export function recordFailedLogin(key: string): void {
  const now = Date.now()
  const record = loginRateLimitMap.get(key)

  if (!record || now > record.resetTime) {
    loginRateLimitMap.set(key, {
      count: 1,
      resetTime: now + WINDOW_MS,
    })
  } else {
    record.count += 1
  }
}

export function resetLoginRateLimit(key: string): void {
  loginRateLimitMap.delete(key)
}

export function resetLoginRateLimitForEmail(email: string): void {
  const prefix = `${email.toLowerCase().trim()}:`
  for (const key of loginRateLimitMap.keys()) {
    if (key.startsWith(prefix)) {
      loginRateLimitMap.delete(key)
    }
  }
}

export function getClientIp(req?: unknown): string {
  if (!req || typeof req !== 'object') return '127.0.0.1'
  const r = req as Record<string, unknown>
  const headers = r.headers as Record<string, unknown> | undefined

  if (headers) {
    if (typeof (headers as { get?: (k: string) => string | null }).get === 'function') {
      const h = headers as { get: (k: string) => string | null }
      const fwd = h.get('x-forwarded-for')
      if (fwd) return fwd.split(',')[0].trim()
      const real = h.get('x-real-ip')
      if (real) return real.trim()
    } else {
      const fwd = headers['x-forwarded-for']
      if (typeof fwd === 'string') return fwd.split(',')[0].trim()
      if (Array.isArray(fwd) && fwd[0]) return String(fwd[0]).split(',')[0].trim()
      const real = headers['x-real-ip']
      if (typeof real === 'string') return real.trim()
    }
  }

  return '127.0.0.1'
}
