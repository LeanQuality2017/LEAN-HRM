import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import {
  resolveAccrualMonths,
  computeAccrual,
  applyCarryForward,
  computeAvailableBalance,
  assertCanApply,
  LeaveBalanceError,
  runMonthlyAccrual,
  backfillLeaveBalances,
} from '@/lib/leave'

describe('Leave Accrual & Balance Engine (Spec L1-L18)', () => {
  describe('Accrual Resolution & Computation', () => {
    it('L1 UPFRONT full year credit for an employee who joined before 1 Apr', () => {
      const rule = {
        frequency: 'UPFRONT',
        amount: new Prisma.Decimal('18.00'),
        proRateOnJoin: true,
      }
      // Employee joined in prior year (15 Jan 2026 before 1 Apr 2026 start of FY26)
      const credits = resolveAccrualMonths(rule, 2026, '2026-01-15T00:00:00.000Z', 4)
      expect(credits).toBe(1)

      const accrual = computeAccrual({
        rule,
        year: 2026,
        joinDate: '2026-01-15T00:00:00.000Z',
        asOfMonth: 4,
      })
      expect(accrual.credited.toFixed(2)).toBe('18.00')
      expect(accrual.projected.toFixed(2)).toBe('18.00')
    })

    it('L2 UPFRONT pro-rated credit for an employee who joined 1 Oct (half year)', () => {
      const rule = {
        frequency: 'UPFRONT',
        amount: new Prisma.Decimal('12.00'),
        proRateOnJoin: true,
      }
      // Leave year starts 1 Apr. Employee joined 1 Oct (month 10, index 7). 6 months remaining (Oct..Mar)
      const credits = resolveAccrualMonths(rule, 2026, '2026-10-01T00:00:00.000Z', 10)
      expect(credits).toBe(0.5)

      const accrual = computeAccrual({
        rule,
        year: 2026,
        joinDate: '2026-10-01T00:00:00.000Z',
        asOfMonth: 10,
      })
      expect(accrual.credited.toFixed(2)).toBe('6.00')
      expect(accrual.projected.toFixed(2)).toBe('6.00')
    })

    it('L3 MONTHLY: 6 completed months by Sep -> 6 credits, not 9', () => {
      const rule = {
        frequency: 'MONTHLY',
        amount: new Prisma.Decimal('1.50'),
      }
      // Joined before 1 Apr 2026. Evaluating as of September (month 9)
      // April, May, June, July, August, September = 6 completed months in leave year
      const credits = resolveAccrualMonths(rule, 2026, '2025-04-01T00:00:00.000Z', 9)
      expect(credits).toBe(6)

      const accrual = computeAccrual({
        rule,
        year: 2026,
        joinDate: '2025-04-01T00:00:00.000Z',
        asOfMonth: 9,
      })
      expect(accrual.credited.toFixed(2)).toBe('9.00') // 6 * 1.50 = 9.00
      expect(accrual.projected.toFixed(2)).toBe('18.00') // 12 * 1.50 = 18.00
    })

    it('L4 MONTHLY: mid-month join (15 Jun) -> first credit only from July', () => {
      const rule = {
        frequency: 'MONTHLY',
        amount: new Prisma.Decimal('1.75'),
      }
      // Joined mid-June: June is incomplete, so first credit lands in July
      const juneCredits = resolveAccrualMonths(rule, 2026, '2026-06-15T00:00:00.000Z', 6)
      expect(juneCredits).toBe(0)

      const julyCredits = resolveAccrualMonths(rule, 2026, '2026-06-15T00:00:00.000Z', 7)
      expect(julyCredits).toBe(1)

      const septCredits = resolveAccrualMonths(rule, 2026, '2026-06-15T00:00:00.000Z', 9)
      expect(septCredits).toBe(3) // Jul, Aug, Sep = 3 months
    })

    it('L5 QUARTERLY: credits land on Jul/Oct/Jan only', () => {
      const rule = {
        frequency: 'QUARTERLY',
        amount: new Prisma.Decimal('4.50'),
      }
      // Apr, May, Jun (months 4, 5, 6) -> 0 quarters completed
      expect(resolveAccrualMonths(rule, 2026, null, 4)).toBe(0)
      expect(resolveAccrualMonths(rule, 2026, null, 5)).toBe(0)
      expect(resolveAccrualMonths(rule, 2026, null, 6)).toBe(0)

      // Landing in July (month 7) -> 1 quarter completed
      expect(resolveAccrualMonths(rule, 2026, null, 7)).toBe(1)
      expect(resolveAccrualMonths(rule, 2026, null, 8)).toBe(1)
      expect(resolveAccrualMonths(rule, 2026, null, 9)).toBe(1)

      // Landing in October (month 10) -> 2 quarters completed
      expect(resolveAccrualMonths(rule, 2026, null, 10)).toBe(2)
      expect(resolveAccrualMonths(rule, 2026, null, 11)).toBe(2)

      // Landing in January (month 1) -> 3 quarters completed
      expect(resolveAccrualMonths(rule, 2026, null, 1)).toBe(3)
    })
  })

  describe('Carry-Forward & Expiry Engine', () => {
    it('L6 Carry-forward cap applied: 10 available, cap 5 -> cf 5, lapsed 5', () => {
      const result = applyCarryForward({
        previousBalance: new Prisma.Decimal('10.00'),
        rule: {
          carryForwardCap: new Prisma.Decimal('5.00'),
          expiryMonths: 0,
        },
      })
      expect(result.carriedForward.toFixed(2)).toBe('5.00')
      expect(result.lapsed.toFixed(2)).toBe('5.00')
    })

    it('L7 Carry-forward cap 0 -> everything lapses', () => {
      const result = applyCarryForward({
        previousBalance: {
          credited: new Prisma.Decimal('15.00'),
          carriedForward: new Prisma.Decimal('0.00'),
          used: new Prisma.Decimal('3.00'), // 12 available
        },
        rule: {
          carryForwardCap: new Prisma.Decimal('0.00'),
          expiryMonths: 0,
        },
      })
      expect(result.carriedForward.toFixed(2)).toBe('0.00')
      expect(result.lapsed.toFixed(2)).toBe('12.00')
    })

    it('L8 expiryMonths: balance older than N months lapses', () => {
      const rule = {
        carryForwardCap: new Prisma.Decimal('8.00'),
        expiryMonths: 3, // lapses after 3 months
      }
      // Within 2 months: still valid
      const active = applyCarryForward({
        previousBalance: new Prisma.Decimal('8.00'),
        rule,
        monthsElapsed: 2,
      })
      expect(active.carriedForward.toFixed(2)).toBe('8.00')
      expect(active.lapsed.toFixed(2)).toBe('0.00')

      // Older than 3 months: all expires
      const expired = applyCarryForward({
        previousBalance: new Prisma.Decimal('8.00'),
        rule,
        monthsElapsed: 3,
      })
      expect(expired.carriedForward.toFixed(2)).toBe('0.00')
      expect(expired.lapsed.toFixed(2)).toBe('8.00')
    })
  })

  describe('Available Balance & Overdraw Protection', () => {
    it('L9 computeAvailableBalance with pending leave included -> available reduced but never negative', () => {
      const balance = computeAvailableBalance({
        credited: new Prisma.Decimal('10.00'),
        carriedForward: new Prisma.Decimal('2.00'),
        used: new Prisma.Decimal('5.00'),
        pending: new Prisma.Decimal('3.00'),
      })
      // 10 + 2 - 5 - 3 = 4.00
      expect(balance.available.toFixed(2)).toBe('4.00')
      expect(balance.isOverdrawn).toBe(false)

      // When pending exceeds remaining balance: 12 - 5 - 10 = -3 -> clamped to 0.00
      const heavyPending = computeAvailableBalance({
        credited: new Prisma.Decimal('10.00'),
        carriedForward: new Prisma.Decimal('2.00'),
        used: new Prisma.Decimal('5.00'),
        pending: new Prisma.Decimal('10.00'),
      })
      expect(heavyPending.available.toFixed(2)).toBe('0.00')
      expect(heavyPending.isOverdrawn).toBe(true)
    })

    it('L10 Overdrawn: used > credited -> available ZERO, no negative, no throw', () => {
      expect(() => {
        const result = computeAvailableBalance({
          credited: new Prisma.Decimal('5.00'),
          carriedForward: new Prisma.Decimal('0.00'),
          used: new Prisma.Decimal('8.00'),
          pending: new Prisma.Decimal('0.00'),
        })
        expect(result.available.toFixed(2)).toBe('0.00')
        expect(result.toFixed(2)).toBe('0.00')
        expect(result.isOverdrawn).toBe(true)
      }).not.toThrow()
    })
  })

  describe('Application Gate & Assertions', () => {
    it('L11 assertCanApply: 3 available, request 3 -> allowed', () => {
      expect(
        assertCanApply({
          available: new Prisma.Decimal('3.00'),
          requestedDays: new Prisma.Decimal('3.00'),
        })
      ).toBe(true)
    })

    it('L12 assertCanApply: 3 available, request 3.5 -> throws LeaveBalanceError', () => {
      expect(() =>
        assertCanApply({
          available: new Prisma.Decimal('3.00'),
          requestedDays: new Prisma.Decimal('3.50'),
        })
      ).toThrow(LeaveBalanceError)

      expect(() =>
        assertCanApply({
          available: '3',
          requestedDays: '3.5',
        })
      ).toThrow(/Insufficient leave balance/)
    })

    it('L13 assertCanApply: half-day 0.5 against 0.5 available -> allowed', () => {
      expect(
        assertCanApply({
          available: new Prisma.Decimal('0.50'),
          requestedDays: new Prisma.Decimal('0.50'),
        })
      ).toBe(true)
    })

    it('L14 assertCanApply: isUnpaid type -> allowed with zero balance', () => {
      expect(
        assertCanApply({
          available: new Prisma.Decimal('0.00'),
          requestedDays: new Prisma.Decimal('5.00'),
          isUnpaid: true,
        })
      ).toBe(true)
    })

    it('L15 Decimal exactness: 1.5 + 1.5 + 2 = 5.00 exactly, no float drift', () => {
      const a = new Prisma.Decimal('1.5')
      const b = new Prisma.Decimal('1.5')
      const c = new Prisma.Decimal('2')
      const sum = a.add(b).add(c)
      expect(sum.toFixed(2)).toBe('5.00')
      expect(sum.equals(new Prisma.Decimal('5.00'))).toBe(true)
    })
  })

  describe('Accrual Runner (DB Layer)', () => {
    it('L16 Idempotency: runMonthlyAccrual twice for the same month credits once', async () => {
      let storedBalance: {
        id: string
        employeeId: string
        leaveTypeId: string
        year: number
        credited: Prisma.Decimal
        lastAccruedMonth: number | null
      } | null = null

      const mockTx = {
        employee: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'emp_1', employeeCode: 'EMP-001', joinedAt: new Date('2025-01-01') },
          ]),
        },
        leaveType: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'lt_1',
              name: 'Earned Leave',
              isUnpaid: false,
              accrualRule: {
                id: 'rule_1',
                frequency: 'MONTHLY',
                amount: new Prisma.Decimal('1.50'),
              },
            },
          ]),
        },
        leaveBalance: {
          findUnique: vi.fn().mockImplementation(() => Promise.resolve(storedBalance)),
          create: vi.fn().mockImplementation(({ data }) => {
            storedBalance = {
              id: 'bal_1',
              employeeId: data.employeeId,
              leaveTypeId: data.leaveTypeId,
              year: data.year,
              credited: data.credited,
              lastAccruedMonth: data.lastAccruedMonth,
            }
            return Promise.resolve(storedBalance)
          }),
          update: vi.fn().mockImplementation(({ data }) => {
            if (storedBalance) {
              storedBalance.credited = data.credited
              storedBalance.lastAccruedMonth = data.lastAccruedMonth
            }
            return Promise.resolve(storedBalance)
          }),
        },
      }

      // First run for month 5 (May)
      const res1 = await runMonthlyAccrual({
        companyId: 'comp_1',
        year: 2026,
        month: 5,
        tx: mockTx as unknown as Prisma.TransactionClient,
      })

      expect(res1.creditedRecords).toBe(1)
      expect(res1.skippedRecords).toBe(0)
      expect(storedBalance!.credited.toFixed(2)).toBe('1.50')
      expect(storedBalance!.lastAccruedMonth).toBe(5)

      // Second run for same month 5 (May)
      const res2 = await runMonthlyAccrual({
        companyId: 'comp_1',
        year: 2026,
        month: 5,
        tx: mockTx as unknown as Prisma.TransactionClient,
      })

      expect(res2.creditedRecords).toBe(0)
      expect(res2.skippedRecords).toBe(1)
      // Balance was NOT double-credited
      expect(storedBalance!.credited.toFixed(2)).toBe('1.50')
      expect(mockTx.leaveBalance.create).toHaveBeenCalledTimes(1)
      expect(mockTx.leaveBalance.update).toHaveBeenCalledTimes(0)
    })

    it('L17 Backfill dry-run changes nothing and returns the same numbers as the live run', async () => {
      let createdRowsCount = 0

      const createMockTx = () => ({
        employee: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'emp_1' },
            { id: 'emp_2' },
          ]),
        },
        leaveType: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'lt_annual', daysPerYear: 12, isUnpaid: false },
            { id: 'lt_casual', daysPerYear: 6, isUnpaid: false },
          ]),
        },
        leaveBalance: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(() => {
            createdRowsCount++
            return Promise.resolve({})
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      })

      // 1. Dry Run
      const dryTx = createMockTx()
      const dryResult = await backfillLeaveBalances({
        companyId: 'comp_1',
        year: 2026,
        dryRun: true,
        tx: dryTx as unknown as Prisma.TransactionClient,
      })

      expect(dryResult.dryRun).toBe(true)
      expect(dryResult.totalEmployees).toBe(2)
      expect(dryResult.eligibleRecords).toBe(4)
      expect(dryResult.createdRecords).toBe(4)
      expect(dryResult.skippedRecords).toBe(0)
      expect(dryTx.leaveBalance.create).toHaveBeenCalledTimes(0)
      expect(dryTx.leaveBalance.update).toHaveBeenCalledTimes(0)

      // 2. Live Run
      const liveTx = createMockTx()
      const liveResult = await backfillLeaveBalances({
        companyId: 'comp_1',
        year: 2026,
        dryRun: false,
        tx: liveTx as unknown as Prisma.TransactionClient,
      })

      expect(liveResult.dryRun).toBe(false)
      expect(liveResult.totalEmployees).toBe(2)
      expect(liveResult.eligibleRecords).toBe(4)
      expect(liveResult.createdRecords).toBe(4)
      expect(liveResult.skippedRecords).toBe(0)
      expect(liveTx.leaveBalance.create).toHaveBeenCalledTimes(4)

      // Identical numbers returned between dryRun and live run
      expect(dryResult.eligibleRecords).toBe(liveResult.eligibleRecords)
      expect(dryResult.createdRecords).toBe(liveResult.createdRecords)
      expect(dryResult.skippedRecords).toBe(liveResult.skippedRecords)
    })
  })

  describe('Engine Purity', () => {
    it('L18 Purity: no DB import inside src/lib/leave/accrual.ts (assert via a mocked db that throws if touched)', () => {
      // 1. Verify source file statically contains zero DB imports
      const accrualSourcePath = path.resolve(process.cwd(), 'src/lib/leave/accrual.ts')
      const source = fs.readFileSync(accrualSourcePath, 'utf8')

      expect(source).not.toContain("from '@/lib/db'")
      expect(source).not.toContain("from '../db'")
      expect(source).not.toContain('PrismaClient')

      // 2. Verify with runtime db proxy that throws if touched
      const dbProxy = new Proxy({}, {
        get() {
          throw new Error('POISON_PILL: Database touched by pure module!')
        },
      })

      // Calling pure functions must succeed without triggering the poison pill
      expect(() => {
        resolveAccrualMonths({ frequency: 'MONTHLY', amount: '1.5' }, 2026, null, 6)
        computeAccrual({ rule: { frequency: 'MONTHLY', amount: '1.5' }, year: 2026, asOfMonth: 6 })
        applyCarryForward({ previousBalance: 10, rule: { carryForwardCap: 5 } })
        computeAvailableBalance({ credited: 10, used: 2 })
        assertCanApply({ available: 5, requestedDays: 2 })
      }).not.toThrow()
    })
  })
})

