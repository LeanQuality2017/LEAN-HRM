import { Prisma } from '@prisma/client'

/**
 * Monetary representation and arithmetic utilities for UniHR.
 *
 * Non-negotiable domain rule:
 * ZERO use of JavaScript IEEE-754 `Number` or `parseFloat` for monetary values.
 * All monetary operations are performed using Prisma.Decimal (powered by decimal.js)
 * with strict precision and deterministic rounding.
 *
 * Rounding standard:
 * In accordance with standard Indian payroll and statutory practices, intermediate
 * calculations preserve precision, and monetary amounts are rounded half-up
 * (`Decimal.ROUND_HALF_UP`) to exactly 2 decimal places (paise).
 * Example: 10.555 -> 10.56, 10.554 -> 10.55.
 */

export type Decimal = Prisma.Decimal
export const Decimal = Prisma.Decimal

export const ZERO = new Prisma.Decimal('0.00')
export const ONE = new Prisma.Decimal('1.00')
export const HUNDRED = new Prisma.Decimal('100.00')

/**
 * Converts a monetary input to a Decimal safely without float precision leaks.
 * Passing numbers directly is converted via string representation.
 */
export function toDecimal(val: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal {
  if (val === null || val === undefined) {
    return ZERO
  }
  if (val instanceof Prisma.Decimal) {
    return val
  }
  return new Prisma.Decimal(val.toString())
}

/**
 * Rounds a Decimal to specified decimal places (default 2) using Decimal.ROUND_HALF_UP.
 */
export function round(val: Prisma.Decimal, dp = 2): Prisma.Decimal {
  return val.toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP)
}

/**
 * Rounds a Decimal up to the next integer rupee using Decimal.ROUND_CEIL.
 * Used for statutory contributions where the law mandates rounding up to the next rupee (e.g., ESIC practice).
 */
export function ceilRupee(val: Prisma.Decimal): Prisma.Decimal {
  return val.toDecimalPlaces(0, Prisma.Decimal.ROUND_CEIL)
}

export function add(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.add(b)
}

export function sub(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.sub(b)
}

export function mul(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.mul(b)
}

export function div(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  if (b.isZero()) {
    throw new Error('Division by zero in payroll calculation')
  }
  return a.div(b)
}

export function max(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.greaterThan(b) ? a : b
}

export function min(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.lessThan(b) ? a : b
}

export function isZero(val: Prisma.Decimal): boolean {
  return val.isZero()
}

export function isNegative(val: Prisma.Decimal): boolean {
  return val.isNegative()
}

export function isPositive(val: Prisma.Decimal): boolean {
  return val.isPositive() && !val.isZero()
}

export function equals(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  return a.equals(b)
}

export function formatCurrency(val: Prisma.Decimal): string {
  return round(val).toFixed(2)
}

