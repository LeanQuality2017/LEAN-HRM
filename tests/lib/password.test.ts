import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/password'

describe('Password Utility (src/lib/password.ts)', () => {
  it('should successfully hash and verify a password in a round-trip', () => {
    const rawPassword = 'SecureP@ssword2026!'
    const stored = hashPassword(rawPassword)

    expect(stored).toContain(':')
    const [salt, hash] = stored.split(':')
    expect(salt).toHaveLength(32) // 16 bytes = 32 hex chars
    expect(hash).toHaveLength(128) // 64 bytes = 128 hex chars

    const isValid = verifyPassword(rawPassword, stored)
    expect(isValid).toBe(true)
  })

  it('should generate unique salts for the same password', () => {
    const rawPassword = 'SamePasswordTwice'
    const hash1 = hashPassword(rawPassword)
    const hash2 = hashPassword(rawPassword)

    expect(hash1).not.toBe(hash2)
    expect(verifyPassword(rawPassword, hash1)).toBe(true)
    expect(verifyPassword(rawPassword, hash2)).toBe(true)
  })

  it('should reject an incorrect password', () => {
    const stored = hashPassword('CorrectPassword')
    const isValid = verifyPassword('WrongPassword', stored)

    expect(isValid).toBe(false)
  })

  it('should reject corrupt and malformed hash formats', () => {
    expect(verifyPassword('anyPassword', '')).toBe(false)
    expect(verifyPassword('anyPassword', 'missingcolon')).toBe(false)
    expect(verifyPassword('anyPassword', ':missingSalt')).toBe(false)
    expect(verifyPassword('anyPassword', 'missingHash:')).toBe(false)
    expect(verifyPassword('anyPassword', ':::')).toBe(false)
  })

  it('should safely reject timing-safe buffer length mismatches without throwing', () => {
    const stored = hashPassword('MyPassword')
    const [salt] = stored.split(':')

    // Truncated hash string (Buffer length mismatch)
    const truncated = `${salt}:aabbcc`
    expect(verifyPassword('MyPassword', truncated)).toBe(false)

    // Extended hash string
    const extended = `${salt}:${'a'.repeat(256)}`
    expect(verifyPassword('MyPassword', extended)).toBe(false)
  })

  it('should reject equal-length hashes with invalid content via timingSafeEqual', () => {
    const stored = hashPassword('TargetPassword')
    const [salt, hash] = stored.split(':')

    // Corrupt one character while keeping the exact 64-byte (128-char) length
    const corruptedChar = hash[0] === 'a' ? 'b' : 'a'
    const tamperedHash = corruptedChar + hash.slice(1)
    const tamperedStored = `${salt}:${tamperedHash}`

    expect(verifyPassword('TargetPassword', tamperedStored)).toBe(false)
  })
})

