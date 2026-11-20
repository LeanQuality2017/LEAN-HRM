import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { statutoryBonus, gratuity, fullAndFinal } from '@/lib/payroll/settlement'

describe('Section I: Settlement — Bonus, Gratuity, and Full & Final (I1–I10)', () => {
  // I1: Statutory Bonus: Minimum 30 Days Eligibility Cutoff
  it('I1: Statutory Bonus: Ineligible if days worked in accounting year is less than 30', () => {
    const result = statutoryBonus({
      basicSalary: new Prisma.Decimal('15000.00'),
      daysWorkedInYear: 29, // Less than 30 days
    })

    expect(result.isEligible).toBe(false)
    expect(result.bonusAmount.toFixed(2)).toBe('0.00')
    expect(result.reason).toContain('less than statutory minimum of 30 working days')
  })

  // I2: Statutory Bonus: Wage Eligibility Ceiling (₹21,000)
  it('I2: Statutory Bonus: Ineligible if monthly basic salary exceeds ₹21,000 ceiling', () => {
    const result = statutoryBonus({
      basicSalary: new Prisma.Decimal('21000.01'), // Exceeds ₹21,000
      daysWorkedInYear: 200,
    })

    expect(result.isEligible).toBe(false)
    expect(result.bonusAmount.toFixed(2)).toBe('0.00')
    expect(result.reason).toContain('exceeds statutory eligibility ceiling')
  })

  // I3: Statutory Bonus: Minimum 8.33% Bonus on ₹7,000 Calculation Ceiling
  it('I3: Statutory Bonus: Computes minimum statutory bonus 8.33% on ₹7,000 calculation ceiling', () => {
    // Basic ₹15,000 (eligible <= 21,000)
    // Calculation ceiling is ₹7,000 -> Annual base = ₹7,000 * 12 = ₹84,000
    // Bonus = ₹84,000 * 8.33% = ₹6,997.20 (full year 365/365 days)
    const result = statutoryBonus({
      basicSalary: new Prisma.Decimal('15000.00'),
      daysWorkedInYear: 365,
      bonusRate: new Prisma.Decimal('0.0833'),
    })

    expect(result.isEligible).toBe(true)
    expect(result.calculationWage.toFixed(2)).toBe('7000.00')
    expect(result.appliedRate.toFixed(4)).toBe('0.0833')
    expect(result.bonusAmount.toFixed(2)).toBe('6997.20')
  })

  // I4: Statutory Bonus: Maximum 20.00% Bonus on Calculation Ceiling
  it('I4: Statutory Bonus: Computes maximum statutory bonus 20.00% on calculation ceiling', () => {
    // Calculation ceiling ₹7,000 -> Annual base = ₹84,000
    // Bonus = ₹84,000 * 20.00% = ₹16,800.00
    const result = statutoryBonus({
      basicSalary: new Prisma.Decimal('10000.00'),
      daysWorkedInYear: 365,
      bonusRate: new Prisma.Decimal('0.20'),
    })

    expect(result.isEligible).toBe(true)
    expect(result.appliedRate.toFixed(2)).toBe('0.20')
    expect(result.bonusAmount.toFixed(2)).toBe('16800.00')
  })

  // I5: Statutory Bonus: Rate Clamp Between 8.33% and 20.00%
  it('I5: Statutory Bonus: Clamps rate below 8.33% up to minimum and above 20% down to maximum', () => {
    // Below minimum: 5% should clamp to 8.33%
    const low = statutoryBonus({
      basicSalary: new Prisma.Decimal('10000.00'),
      daysWorkedInYear: 365,
      bonusRate: new Prisma.Decimal('0.05'),
    })
    expect(low.appliedRate.toFixed(4)).toBe('0.0833')
    expect(low.bonusAmount.toFixed(2)).toBe('6997.20')

    // Above maximum: 25% should clamp to 20.00%
    const high = statutoryBonus({
      basicSalary: new Prisma.Decimal('10000.00'),
      daysWorkedInYear: 365,
      bonusRate: new Prisma.Decimal('0.25'),
    })
    expect(high.appliedRate.toFixed(2)).toBe('0.20')
    expect(high.bonusAmount.toFixed(2)).toBe('16800.00')
  })

  // I6: Gratuity: Minimum 5-Year Continuous Service Requirement
  it('I6: Gratuity: Ineligible if tenure is less than 5 completed continuous years', () => {
    const result = gratuity({
      lastDrawnBasic: new Prisma.Decimal('30000.00'),
      tenureYears: 4,
      tenureMonths: 11,
    })

    expect(result.isEligible).toBe(false)
    expect(result.gratuityAmount.toFixed(2)).toBe('0.00')
    expect(result.reason).toContain('less than statutory minimum of 5 years')
  })

  // I7: Gratuity: Standard 15/26 Formula for Service >= 5 Years
  it('I7: Gratuity: Computes correct amount using 15/26 formula for service >= 5 years', () => {
    // Basic ₹30,000, 5 years:
    // (15 / 26) * 30,000 * 5 = 17,307.6923... * 5 = ₹86,538.46
    const result = gratuity({
      lastDrawnBasic: new Prisma.Decimal('30000.00'),
      tenureYears: 5,
      tenureMonths: 0,
    })

    expect(result.isEligible).toBe(true)
    expect(result.roundedYears).toBe(5)
    expect(result.gratuityAmount.toFixed(2)).toBe('86538.46')
  })

  // I8: Gratuity: Part-Year Rounding Policy (> 6 months rounds up, <= 6 months drops)
  it('I8: Gratuity: Part-year tenure > 6 months rounds up to full year; <= 6 months drops', () => {
    // 5 years 7 months -> rounded up to 6 years
    // (15 / 26) * 30,000 * 6 = ₹1,03,846.15
    const roundedUp = gratuity({
      lastDrawnBasic: new Prisma.Decimal('30000.00'),
      tenureYears: 5,
      tenureMonths: 7,
    })
    expect(roundedUp.roundedYears).toBe(6)
    expect(roundedUp.gratuityAmount.toFixed(2)).toBe('103846.15')

    // 5 years 6 months -> dropped to 5 years
    const dropped = gratuity({
      lastDrawnBasic: new Prisma.Decimal('30000.00'),
      tenureYears: 5,
      tenureMonths: 6,
    })
    expect(dropped.roundedYears).toBe(5)
    expect(dropped.gratuityAmount.toFixed(2)).toBe('86538.46')
  })

  // I9: Gratuity: Statutory Ceiling Cap of ₹20,00,000 (₹20 Lakhs)
  it('I9: Gratuity: Caps total gratuity payment at statutory limit of ₹20,00,000', () => {
    // High salary: ₹2,00,000 basic, 25 years:
    // (15 / 26) * 200,000 * 25 = 115384.615 * 25 = ₹28,84,615.38 (uncapped)
    // Capped at ₹20,00,000.00
    const result = gratuity({
      lastDrawnBasic: new Prisma.Decimal('200000.00'),
      tenureYears: 25,
      tenureMonths: 0,
    })

    expect(result.isCapped).toBe(true)
    expect(result.uncappedAmount.toFixed(2)).toBe('2884615.38')
    expect(result.gratuityAmount.toFixed(2)).toBe('2000000.00')
  })

  // I10: Full & Final (F&F): Net-Never-Negative Invariant with Recoverable Balance
  it('I10: Full & Final: Guarantees Net-never-negative invariant and routes excess deductions to recoverableBalance', () => {
    // Case A: Net Positive Payout
    // Basic ₹30,000, Gross ₹60,000
    // Unpaid salary 15 days = ₹30,000
    // Leave encashment 10 days = 10 * (30,000 / 30) = ₹10,000
    // Total Additions = ₹40,000
    // Deductions: Notice shortfall 5 days = 5 * (60,000 / 30) = ₹10,000
    // Net = ₹40,000 - ₹10,000 = ₹30,000, recoverableBalance = 0
    const positiveResult = fullAndFinal({
      employeeId: 'emp-exit-1',
      lastDrawnBasic: new Prisma.Decimal('30000.00'),
      lastDrawnGross: new Prisma.Decimal('60000.00'),
      workedDaysInExitMonth: 15,
      leaveEncashmentDays: 10,
      noticeShortfallDays: 5,
    })

    expect(positiveResult.totalAdditions.toFixed(2)).toBe('40000.00')
    expect(positiveResult.totalDeductions.toFixed(2)).toBe('10000.00')
    expect(positiveResult.netPayable.toFixed(2)).toBe('30000.00')
    expect(positiveResult.recoverableBalance.toFixed(2)).toBe('0.00')

    // Case B: Net Negative Excess Deductions (Employee owes company)
    // Additions: Unpaid salary = ₹10,000
    // Deductions: Notice recovery ₹40,000 + Asset recovery ₹15,000 = ₹55,000
    // Net must clamp to ₹0.00, recoverableBalance must be ₹45,000
    const negativeResult = fullAndFinal({
      employeeId: 'emp-exit-2',
      lastDrawnBasic: new Prisma.Decimal('30000.00'),
      lastDrawnGross: new Prisma.Decimal('60000.00'),
      unpaidSalaryAmount: new Prisma.Decimal('10000.00'),
      noticeShortfallDays: 20, // 20 * (60,000 / 30) = ₹40,000
      assetRecovery: new Prisma.Decimal('15000.00'),
    })

    expect(negativeResult.totalAdditions.toFixed(2)).toBe('10000.00')
    expect(negativeResult.totalDeductions.toFixed(2)).toBe('55000.00')
    expect(negativeResult.netPayable.toFixed(2)).toBe('0.00') // Invariant: Net never negative
    expect(negativeResult.recoverableBalance.toFixed(2)).toBe('45000.00') // Recoverable debt
  })
})
