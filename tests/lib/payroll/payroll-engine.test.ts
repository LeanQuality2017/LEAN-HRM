import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  toDecimal,
  round,
  add,
  sub,
  mul,
  div,
  ZERO,
  formatCurrency,
  resolveStructure,
  computeLop,
  pfWages,
  epf,
  eps,
  esi,
  professionalTax,
  tds,
  computePayslip,
  PayrollCalculationError,
} from '@/lib/payroll'

describe('Payroll Calculation Engine (Pure Modules)', () => {
  describe('1. Attendance & LOP Proration', () => {
    it('calculates mid-month join correctly (June 16 join in 30-day month)', () => {
      const payRule = { workingDaysBasis: 'CALENDAR', otMultiplier: new Prisma.Decimal('1.50') }
      const result = computeLop(
        { lopDays: 0, otHours: 0 },
        payRule,
        {
          employee: { startDate: new Date('2026-06-16T00:00:00Z') },
          month: 6,
          year: 2026,
        }
      )

      expect(result.totalMonthDays.toFixed(2)).toBe('30.00')
      expect(result.lopDays.toFixed(2)).toBe('15.00')
      expect(result.paidDays.toFixed(2)).toBe('15.00')
      expect(result.prorationFactor.toFixed(2)).toBe('0.50')
    })

    it('calculates mid-month exit correctly (June 10 exit in 30-day month)', () => {
      const payRule = { workingDaysBasis: 'CALENDAR', otMultiplier: new Prisma.Decimal('1.50') }
      const result = computeLop(
        { lopDays: 0, otHours: 0 },
        payRule,
        {
          employee: { endDate: new Date('2026-06-10T00:00:00Z') },
          month: 6,
          year: 2026,
        }
      )

      expect(result.totalMonthDays.toFixed(2)).toBe('30.00')
      expect(result.lopDays.toFixed(2)).toBe('20.00')
      expect(result.paidDays.toFixed(2)).toBe('10.00')
      expect(round(result.prorationFactor, 4).toFixed(4)).toBe('0.3333')
    })

    it('calculates full LOP month correctly', () => {
      const payRule = { workingDaysBasis: 'CALENDAR' }
      const result = computeLop(
        { lopDays: 30, otHours: 0 },
        payRule,
        { month: 4, year: 2026 }
      )

      expect(result.totalMonthDays.toFixed(2)).toBe('30.00')
      expect(result.lopDays.toFixed(2)).toBe('30.00')
      expect(result.paidDays.toFixed(2)).toBe('0.00')
      expect(result.prorationFactor.toFixed(2)).toBe('0.00')
    })

    it('respects FIXED_26 and explicit lopDivisor', () => {
      const payRule = { workingDaysBasis: 'FIXED_26', lopDivisor: new Prisma.Decimal('26.00') }
      const result = computeLop(
        { lopDays: 2, otHours: 0 },
        payRule,
        { month: 5, year: 2026 }
      )

      expect(result.totalMonthDays.toFixed(2)).toBe('26.00')
      expect(result.lopDays.toFixed(2)).toBe('2.00')
      expect(result.paidDays.toFixed(2)).toBe('24.00')
      expect(round(result.prorationFactor, 4).toFixed(4)).toBe('0.9231')
    })
  })

  describe('2. Statutory PF Rules (Ceiling & Contributions)', () => {
    it('computes PF wages capped at ₹15,000 ceiling when pfCeiling is true', () => {
      // Below ceiling
      const below = pfWages(new Prisma.Decimal('12000.00'), true)
      expect(below.toFixed(2)).toBe('12000.00')

      // Exact ceiling boundary
      const exact = pfWages(new Prisma.Decimal('15000.00'), true)
      expect(exact.toFixed(2)).toBe('15000.00')

      // Above ceiling
      const above = pfWages(new Prisma.Decimal('35000.00'), true)
      expect(above.toFixed(2)).toBe('15000.00')
    })

    it('computes PF wages uncapped when pfCeiling is false', () => {
      const uncapped = pfWages(new Prisma.Decimal('35000.00'), false)
      expect(uncapped.toFixed(2)).toBe('35000.00')
    })

    it('computes employee EPF at 12%', () => {
      expect(epf(new Prisma.Decimal('15000.00')).toFixed(2)).toBe('1800.00')
      expect(epf(new Prisma.Decimal('12000.00')).toFixed(2)).toBe('1440.00')
      expect(epf(ZERO).toFixed(2)).toBe('0.00')
    })

    it('computes employer EPS at 8.33% capped at wage ceiling', () => {
      // 15,000 * 8.33% = 1249.50
      expect(eps(new Prisma.Decimal('15000.00')).toFixed(2)).toBe('1249.50')
      // Even if uncapped wages passed, EPS must cap at ceiling
      expect(eps(new Prisma.Decimal('40000.00')).toFixed(2)).toBe('1249.50')
      // Below ceiling: 10,000 * 8.33% = 833.00
      expect(eps(new Prisma.Decimal('10000.00')).toFixed(2)).toBe('833.00')
    })
  })

  describe('3. Statutory ESI Rules (₹21,000 Boundary)', () => {
    it('applies ESI at or below ₹21,000 gross monthly wage boundary', () => {
      // At exact boundary: ₹21,000
      const exact = esi(new Prisma.Decimal('21000.00'), true)
      // Employee 0.75% of 21,000 = 157.50
      expect(exact.employee.toFixed(2)).toBe('157.50')
      // Employer 3.25% of 21,000 = 682.50
      expect(exact.employer.toFixed(2)).toBe('682.50')

      // Below boundary: ₹18,000
      const below = esi(new Prisma.Decimal('18000.00'), true)
      expect(below.employee.toFixed(2)).toBe('135.00')
      expect(below.employer.toFixed(2)).toBe('585.00')
    })

    it('exempts ESI immediately above ₹21,000 gross boundary', () => {
      // 1 paisa above boundary: ₹21,000.01
      const above = esi(new Prisma.Decimal('21000.01'), true)
      expect(above.employee.toFixed(2)).toBe('0.00')
      expect(above.employer.toFixed(2)).toBe('0.00')

      // ₹25,000 gross
      const high = esi(new Prisma.Decimal('25000.00'), true)
      expect(high.employee.toFixed(2)).toBe('0.00')
      expect(high.employer.toFixed(2)).toBe('0.00')
    })

    it('returns zero when esiApplicable is false', () => {
      const disabled = esi(new Prisma.Decimal('15000.00'), false)
      expect(disabled.employee.toFixed(2)).toBe('0.00')
      expect(disabled.employer.toFixed(2)).toBe('0.00')
    })
  })

  describe('4. Professional Tax Slabs (Multiple States)', () => {
    it('evaluates Tamil Nadu (TN) monthly apportioned slabs', () => {
      expect(professionalTax('TN', new Prisma.Decimal('3000.00')).toFixed(2)).toBe('0.00')
      expect(professionalTax('TN', new Prisma.Decimal('4500.00')).toFixed(2)).toBe('20.00')
      expect(professionalTax('TN', new Prisma.Decimal('6000.00')).toFixed(2)).toBe('40.00')
      expect(professionalTax('TN', new Prisma.Decimal('9000.00')).toFixed(2)).toBe('80.00')
      expect(professionalTax('TN', new Prisma.Decimal('11000.00')).toFixed(2)).toBe('125.00')
      expect(professionalTax('TN', new Prisma.Decimal('25000.00')).toFixed(2)).toBe('208.33')
    })

    it('evaluates Maharashtra (MH) monthly slabs', () => {
      expect(professionalTax('MH', new Prisma.Decimal('5000.00')).toFixed(2)).toBe('0.00')
      expect(professionalTax('MH', new Prisma.Decimal('7500.00')).toFixed(2)).toBe('0.00')
      expect(professionalTax('MH', new Prisma.Decimal('8500.00')).toFixed(2)).toBe('175.00')
      expect(professionalTax('MH', new Prisma.Decimal('15000.00')).toFixed(2)).toBe('200.00')
    })

    it('evaluates Karnataka (KA) 2023 revised slabs', () => {
      expect(professionalTax('KA', new Prisma.Decimal('20000.00')).toFixed(2)).toBe('0.00')
      expect(professionalTax('KA', new Prisma.Decimal('25000.00')).toFixed(2)).toBe('0.00')
      expect(professionalTax('KA', new Prisma.Decimal('25000.01')).toFixed(2)).toBe('200.00')
      expect(professionalTax('KA', new Prisma.Decimal('50000.00')).toFixed(2)).toBe('200.00')
    })
  })

  describe('5. TDS Regime Handling', () => {
    it('throws when TDS regime is not configured or empty', () => {
      expect(() => tds(null)).toThrow('TDS regime not configured')
      expect(() => tds({ tdsRegime: null })).toThrow('TDS regime not configured')
      expect(() => tds({ tdsRegime: '' })).toThrow('TDS regime not configured')
    })

    it('throws when TDS regime is invalid', () => {
      expect(() => tds({ tdsRegime: 'INVALID' })).toThrow('Unsupported TDS regime')
    })

    it('returns zero for valid regimes (placeholder implementation)', () => {
      expect(tds({ tdsRegime: 'NEW' }).toFixed(2)).toBe('0.00')
      expect(tds({ tdsRegime: 'OLD' }).toFixed(2)).toBe('0.00')
    })
  })

  describe('6. Money Utility & Rounding Edge Cases', () => {
    it('handles ROUND_HALF_UP on exact halves', () => {
      expect(round(new Prisma.Decimal('10.555')).toFixed(2)).toBe('10.56')
      expect(round(new Prisma.Decimal('10.554')).toFixed(2)).toBe('10.55')
      expect(round(new Prisma.Decimal('0.005')).toFixed(2)).toBe('0.01')
      expect(round(new Prisma.Decimal('0.004')).toFixed(2)).toBe('0.00')
    })

    it('handles division without floating point precision loss', () => {
      // 100 / 3 = 33.3333... rounded to 2dp = 33.33
      const divided = round(div(new Prisma.Decimal('100.00'), new Prisma.Decimal('3.00')))
      expect(divided.toFixed(2)).toBe('33.33')
    })

    it('throws on division by zero', () => {
      expect(() => div(new Prisma.Decimal('100.00'), ZERO)).toThrow('Division by zero')
    })
  })

  describe('7. Overtime (OT) Calculation', () => {
    it('calculates OT with explicit hourly rate and multiplier', () => {
      const line = computePayslip({
        runId: 'run-1',
        month: 6,
        year: 2026,
        employee: {
          id: 'emp-ot',
          baseSalary: new Prisma.Decimal('30000.00'),
          hourlyRate: new Prisma.Decimal('200.00'),
          statutoryProfile: { pfApplicable: false, esiApplicable: false, ptState: 'TN', tdsRegime: 'NEW' },
        },
        payRule: { workingDaysBasis: 'CALENDAR', otMultiplier: new Prisma.Decimal('1.50') },
        summary: { lopDays: 0, otHours: 10 },
      })

      // OT Amount = 10 hrs * ₹200/hr * 1.5 = ₹3,000.00
      // Gross = ₹30,000 + ₹3,000 = ₹33,000.00
      expect(line.gross.toFixed(2)).toBe('33000.00')
      expect(line.daysPaid.toFixed(2)).toBe('30.00')
    })

    it('calculates OT with derived hourly rate when hourlyRate is null', () => {
      // Base: ₹24,000 -> Basic = 50% = ₹12,000
      // 30 days month -> standard hours = 30 * 8 = 240 hrs
      // Derived hourly rate = 12000 / 240 = ₹50/hr
      // OT = 8 hrs * ₹50/hr * 2.0 multiplier = ₹800.00
      const line = computePayslip({
        runId: 'run-2',
        month: 6,
        year: 2026,
        employee: {
          id: 'emp-ot-derived',
          baseSalary: new Prisma.Decimal('24000.00'),
          hourlyRate: null,
          statutoryProfile: { pfApplicable: false, esiApplicable: false, ptState: 'TN', tdsRegime: 'NEW' },
        },
        payRule: { workingDaysBasis: 'CALENDAR', otMultiplier: new Prisma.Decimal('2.00') },
        summary: { lopDays: 0, otHours: 8 },
      })

      expect(line.gross.toFixed(2)).toBe('24800.00')
    })
  })

  describe('8. Zero Salary & Full LOP Payslips', () => {
    it('handles employee with zero base salary safely', () => {
      const line = computePayslip({
        runId: 'run-zero',
        month: 6,
        year: 2026,
        employee: {
          id: 'emp-zero',
          baseSalary: ZERO,
          statutoryProfile: { pfApplicable: true, esiApplicable: true, ptState: 'TN', tdsRegime: 'NEW' },
        },
        payRule: { workingDaysBasis: 'CALENDAR' },
        summary: { lopDays: 0, otHours: 0 },
      })

      expect(line.gross.toFixed(2)).toBe('0.00')
      expect(line.deductions.toFixed(2)).toBe('0.00')
      expect(line.statutory.toFixed(2)).toBe('0.00')
      expect(line.net.toFixed(2)).toBe('0.00')
    })

    it('handles full month LOP payslip', () => {
      const line = computePayslip({
        runId: 'run-lop',
        month: 6,
        year: 2026,
        employee: {
          id: 'emp-lop',
          baseSalary: new Prisma.Decimal('40000.00'),
          statutoryProfile: { pfApplicable: true, esiApplicable: true, ptState: 'TN', tdsRegime: 'NEW' },
        },
        payRule: { workingDaysBasis: 'CALENDAR' },
        summary: { lopDays: 30, otHours: 0 },
      })

      expect(line.gross.toFixed(2)).toBe('0.00')
      expect(line.deductions.toFixed(2)).toBe('0.00')
      expect(line.statutory.toFixed(2)).toBe('0.00')
      expect(line.net.toFixed(2)).toBe('0.00')
      expect(line.daysPaid.toFixed(2)).toBe('0.00')
      expect(line.lopDays.toFixed(2)).toBe('30.00')
    })
  })

  describe('9. Negative Net Guard', () => {
    it('throws PayrollCalculationError when deductions exceed gross', () => {
      expect(() =>
        computePayslip({
          runId: 'run-neg',
          month: 6,
          year: 2026,
          employee: {
            id: 'emp-neg',
            baseSalary: new Prisma.Decimal('10000.00'),
            salaryStructures: [
              {
                effectiveFrom: '2026-01-01',
                components: [
                  { name: 'BASIC', type: 'EARNING', amount: new Prisma.Decimal('10000.00') },
                  // Excess deduction component exceeding gross
                  { name: 'SALARY_ADVANCE_RECOVERY', type: 'DEDUCTION', amount: new Prisma.Decimal('15000.00') },
                ],
              },
            ],
            statutoryProfile: { pfApplicable: false, esiApplicable: false, ptState: 'TN', tdsRegime: 'NEW' },
          },
          payRule: { workingDaysBasis: 'CALENDAR' },
          summary: { lopDays: 0, otHours: 0 },
        })
      ).toThrow(PayrollCalculationError)
    })
  })

  describe('10. Integrated Mid-Month Join & Exit Payslips', () => {
    it('prorates salary and deductions for employee joining on June 16', () => {
      // ₹50,000 base salary -> Basic ₹25,000, HRA ₹15,000, Special ₹10,000
      // 15 days worked out of 30 days -> 50% proration
      // Prorated Basic = ₹12,500
      // Prorated Gross = ₹25,000
      // PF: 12% of 12,500 = ₹1,500.00
      // ESI: exempt (> ₹21,000 gross)
      // PT (TN): Gross ₹25,000 -> ₹208.33
      // Total Statutory = ₹1,500 + ₹208.33 = ₹1,708.33
      // Net = ₹25,000 - ₹1,708.33 = ₹23,291.67
      const line = computePayslip({
        runId: 'run-join',
        month: 6,
        year: 2026,
        employee: {
          id: 'emp-joined-mid',
          baseSalary: new Prisma.Decimal('50000.00'),
          startDate: '2026-06-16',
          statutoryProfile: {
            pfApplicable: true,
            pfCeiling: true,
            esiApplicable: true,
            ptState: 'TN',
            tdsRegime: 'NEW',
          },
        },
        payRule: { workingDaysBasis: 'CALENDAR' },
        summary: { lopDays: 0, otHours: 0 },
      })

      expect(line.daysPaid.toFixed(2)).toBe('15.00')
      expect(line.lopDays.toFixed(2)).toBe('15.00')
      expect(line.gross.toFixed(2)).toBe('25000.00')
      expect(line.statutory.toFixed(2)).toBe('1708.33')
      expect(line.net.toFixed(2)).toBe('23291.67')
    })
  })
})
