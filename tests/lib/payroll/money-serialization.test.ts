import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { serializeMoney, parseEarningsBreakdown } from '@/lib/payroll'
import { fmtMoney } from '@/lib/constants'

describe('Money Serialization at API Boundary & Component Breakdown Derivation', () => {
  describe('serializeMoney', () => {
    it('5.a: serializeMoney(new Prisma.Decimal("1234.5")) === "1234.50"', () => {
      const result = serializeMoney(new Prisma.Decimal('1234.5'))
      expect(result).toBe('1234.50')
      expect(typeof result).toBe('string')
    })

    it('5.b: serializeMoney(new Prisma.Decimal("0")) === "0.00"', () => {
      const result = serializeMoney(new Prisma.Decimal('0'))
      expect(result).toBe('0.00')
      expect(typeof result).toBe('string')
    })

    it('5.c: serializeMoney(null) === "0.00" and serializeMoney(undefined) === "0.00"', () => {
      expect(serializeMoney(null)).toBe('0.00')
      expect(serializeMoney(undefined)).toBe('0.00')
      expect(serializeMoney('')).toBe('0.00')
    })

    it('5.d: serializeMoney("-42.5") === "-42.50" (does not throw)', () => {
      expect(() => serializeMoney('-42.5')).not.toThrow()
      const result = serializeMoney('-42.5')
      expect(result).toBe('-42.50')
    })

    it('handles rounding half up to 2 decimal places properly', () => {
      expect(serializeMoney(new Prisma.Decimal('10.005'))).toBe('10.01')
      expect(serializeMoney(new Prisma.Decimal('10.004'))).toBe('10.00')
      expect(serializeMoney(100.5)).toBe('100.50')
    })

    it('never returns NaN or Infinity for unparseable input', () => {
      expect(serializeMoney('invalid')).toBe('0.00')
      expect(serializeMoney(NaN)).toBe('0.00')
      expect(serializeMoney(Infinity)).toBe('0.00')
    })
  })

  describe('fmtMoney', () => {
    it('5.e: fmtMoney("1234.50") === fmtMoney(1234.5)', () => {
      const fromString = fmtMoney('1234.50')
      const fromNumber = fmtMoney(1234.5)
      expect(fromString).toBe(fromNumber)
      expect(fromString).toBe('₹1,234.50')
    })

    it('5.f: fmtMoney(null) === "—"', () => {
      expect(fmtMoney(null)).toBe('—')
      expect(fmtMoney(undefined)).toBe('—')
      expect(fmtMoney('')).toBe('—')
      expect(fmtMoney('not-a-number')).toBe('—')
      expect(fmtMoney(NaN)).toBe('—')
    })
  })

  describe('Derivation of basic/allowances from componentBreakdown (parseEarningsBreakdown)', () => {
    it('5.g.1: with valid breakdown: basic + allowances match components', () => {
      const breakdown = JSON.stringify({
        earnings: [
          { name: 'BASIC', amount: '35000.00' },
          { name: 'HRA', amount: '15000.00' },
          { name: 'SPECIAL_ALLOWANCE', amount: '5000.50' },
        ],
      })
      const result = parseEarningsBreakdown(breakdown)
      expect(result.basic).toBe('35000.00')
      expect(result.allowances).toBe('20000.50')
    })

    it('5.g.2: with valid breakdown where type is BASIC instead of name', () => {
      const breakdown = JSON.stringify({
        earnings: [
          { name: 'Basic Salary', type: 'BASIC', amount: '40000.00' },
          { name: 'Transport', type: 'ALLOWANCE', amount: '2000.00' },
        ],
      })
      const result = parseEarningsBreakdown(breakdown)
      expect(result.basic).toBe('40000.00')
      expect(result.allowances).toBe('2000.00')
    })

    it('5.g.3: with valid breakdown having only BASIC and zero allowances', () => {
      const breakdown = JSON.stringify({
        earnings: [{ name: 'BASIC', amount: '50000.00' }],
      })
      const result = parseEarningsBreakdown(breakdown)
      expect(result.basic).toBe('50000.00')
      expect(result.allowances).toBe('0.00')
    })

    it('5.g.4: with invalid breakdown: returns null for both', () => {
      expect(parseEarningsBreakdown('{invalid json')).toEqual({ basic: null, allowances: null })
      expect(parseEarningsBreakdown('random string')).toEqual({ basic: null, allowances: null })
      expect(parseEarningsBreakdown(JSON.stringify({ notEarnings: [] }))).toEqual({
        basic: null,
        allowances: null,
      })
      expect(parseEarningsBreakdown(JSON.stringify({ earnings: 'not-an-array' }))).toEqual({
        basic: null,
        allowances: null,
      })
    })

    it('5.g.5: with missing breakdown: returns null for both', () => {
      expect(parseEarningsBreakdown(null)).toEqual({ basic: null, allowances: null })
      expect(parseEarningsBreakdown(undefined)).toEqual({ basic: null, allowances: null })
      expect(parseEarningsBreakdown('')).toEqual({ basic: null, allowances: null })
    })
  })
})

