import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildRateLimitKey,
  isLoginRateLimited,
  recordFailedLogin,
  resetLoginRateLimit,
  resetLoginRateLimitForEmail,
  loginRateLimitMap,
  getClientIp,
} from '@/lib/rate-limit'

describe('Login Rate Limiter (src/lib/rate-limit.ts)', () => {
  beforeEach(() => {
    loginRateLimitMap.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    loginRateLimitMap.clear()
  })

  it('should correctly build normalized rate limit keys', () => {
    const key1 = buildRateLimitKey('Admin@Company.com ', ' 192.168.1.1 ')
    expect(key1).toBe('admin@company.com:192.168.1.1')

    const key2 = buildRateLimitKey('test@example.com', '')
    expect(key2).toBe('test@example.com:127.0.0.1')
  })

  it('should allow 4 failed attempts and enforce rate limiting on the 5th attempt', () => {
    const key = 'user1@example.com:127.0.0.1'

    // Initial state: not limited
    expect(isLoginRateLimited(key)).toBe(false)

    // 4 failed attempts: still not limited
    for (let i = 1; i <= 4; i++) {
      recordFailedLogin(key)
      expect(isLoginRateLimited(key)).toBe(false)
    }

    // 5th failed attempt: limited
    recordFailedLogin(key)
    expect(isLoginRateLimited(key)).toBe(true)

    // 6th failed attempt: remains limited
    recordFailedLogin(key)
    expect(isLoginRateLimited(key)).toBe(true)
  })

  it('should automatically clear and unblock when the 15-minute window expires', () => {
    const key = 'user2@example.com:127.0.0.1'

    // Exceed limit
    for (let i = 0; i < 5; i++) {
      recordFailedLogin(key)
    }
    expect(isLoginRateLimited(key)).toBe(true)

    // Advance 14 minutes: still within window
    vi.advanceTimersByTime(14 * 60 * 1000)
    expect(isLoginRateLimited(key)).toBe(true)

    // Advance 1 minute + 1 second (total > 15 mins)
    vi.advanceTimersByTime(61 * 1000)

    // Window expired: record should be cleared and rate limiting removed
    expect(isLoginRateLimited(key)).toBe(false)
    expect(loginRateLimitMap.has(key)).toBe(false)
  })

  it('should start a fresh window after previous window expiry', () => {
    const key = 'user3@example.com:127.0.0.1'

    // 1 attempt
    recordFailedLogin(key)

    // Advance past window
    vi.advanceTimersByTime(16 * 60 * 1000)

    // New attempt should reset count to 1 and not be limited
    recordFailedLogin(key)
    expect(isLoginRateLimited(key)).toBe(false)
  })

  it('should reset rate limit for a specific key', () => {
    const key = 'user4@example.com:10.0.0.1'

    for (let i = 0; i < 5; i++) {
      recordFailedLogin(key)
    }
    expect(isLoginRateLimited(key)).toBe(true)

    resetLoginRateLimit(key)
    expect(isLoginRateLimited(key)).toBe(false)
  })

  it('should reset rate limit for all IP addresses associated with an email', () => {
    const email = 'target@example.com'
    const key1 = buildRateLimitKey(email, '1.1.1.1')
    const key2 = buildRateLimitKey(email, '2.2.2.2')
    const unrelatedKey = buildRateLimitKey('other@example.com', '1.1.1.1')

    for (let i = 0; i < 5; i++) {
      recordFailedLogin(key1)
      recordFailedLogin(key2)
      recordFailedLogin(unrelatedKey)
    }

    expect(isLoginRateLimited(key1)).toBe(true)
    expect(isLoginRateLimited(key2)).toBe(true)
    expect(isLoginRateLimited(unrelatedKey)).toBe(true)

    resetLoginRateLimitForEmail(email)

    // Target email records are cleared across all IPs
    expect(isLoginRateLimited(key1)).toBe(false)
    expect(isLoginRateLimited(key2)).toBe(false)

    // Unrelated email record remains intact and limited
    expect(isLoginRateLimited(unrelatedKey)).toBe(true)
  })

  it('should safely extract client IP from diverse request header structures', () => {
    expect(getClientIp(undefined)).toBe('127.0.0.1')
    expect(getClientIp(null)).toBe('127.0.0.1')
    expect(getClientIp({})).toBe('127.0.0.1')

    // Web standard Headers.get() mock
    const standardReq = {
      headers: new Headers({ 'x-forwarded-for': '203.0.113.195, 70.41.3.18' }),
    }
    expect(getClientIp(standardReq)).toBe('203.0.113.195')

    // Direct object header dictionary with x-real-ip
    const directReq = {
      headers: { 'x-real-ip': '198.51.100.4' },
    }
    expect(getClientIp(directReq)).toBe('198.51.100.4')
  })
})

