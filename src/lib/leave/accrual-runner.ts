import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { toDecimal } from './accrual'

export interface RunMonthlyAccrualParams {
  companyId: string
  year: number
  month: number
  tx?: Prisma.TransactionClient
}

export interface MonthlyAccrualResult {
  companyId: string
  year: number
  month: number
  totalEmployees: number
  processedRecords: number
  creditedRecords: number
  skippedRecords: number
}

export interface BackfillLeaveBalancesParams {
  companyId: string
  year: number
  dryRun?: boolean
  tx?: Prisma.TransactionClient
}

export interface BackfillResult {
  companyId: string
  year: number
  dryRun: boolean
  totalEmployees: number
  eligibleRecords: number
  createdRecords: number
  skippedRecords: number
}

/**
 * Executes monthly accrual for all active employees and paid leave types in a company.
 * Completely idempotent: if a record already has `lastAccruedMonth === month`, it will not be credited twice.
 */
export async function runMonthlyAccrual({
  companyId,
  year,
  month,
  tx,
}: RunMonthlyAccrualParams): Promise<MonthlyAccrualResult> {
  const client = tx || db

  // 1. Fetch active employees assigned to company
  const employees = await client.employee.findMany({
    where: {
      status: 'ACTIVE',
      assignments: { some: { companyId } },
    },
    select: {
      id: true,
      employeeCode: true,
      joinedAt: true,
    },
  })

  // 2. Fetch paid leave types with accrual rules
  const leaveTypes = await client.leaveType.findMany({
    where: {
      companyId,
      isUnpaid: false,
      accrualRule: { isNot: null },
    },
    include: {
      accrualRule: true,
    },
  })

  let processedCount = 0
  let creditedCount = 0
  let skippedCount = 0

  for (const emp of employees) {
    for (const lt of leaveTypes) {
      if (!lt.accrualRule) continue

      processedCount++
      const rule = lt.accrualRule

      // Find existing leave balance for this year
      const existingBalance = await client.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: emp.id,
            leaveTypeId: lt.id,
            year,
          },
        },
      })

      // Idempotency check: re-running for the same month credits nothing twice
      if (existingBalance && existingBalance.lastAccruedMonth === month) {
        skippedCount++
        continue
      }

      // Calculate credit amount for this specific month
      const freq = (rule.frequency || '').toUpperCase()
      let creditAmount = new Prisma.Decimal('0.00')

      if (freq === 'MONTHLY') {
        creditAmount = toDecimal(rule.amount)
      } else if (freq === 'QUARTERLY') {
        // Quarter credits land on Jul (7), Oct (10), Jan (1)
        if ([7, 10, 1].includes(month)) {
          creditAmount = toDecimal(rule.amount)
        }
      } else if (freq === 'UPFRONT' || freq === 'YEARLY') {
        // Upfront credit lands on April (month 4)
        if (month === 4) {
          creditAmount = toDecimal(rule.amount)
        }
      }

      if (existingBalance) {
        await client.leaveBalance.update({
          where: { id: existingBalance.id },
          data: {
            credited: existingBalance.credited.add(creditAmount),
            lastAccruedMonth: month,
          },
        })
      } else {
        await client.leaveBalance.create({
          data: {
            employeeId: emp.id,
            leaveTypeId: lt.id,
            year,
            credited: creditAmount,
            used: new Prisma.Decimal('0.00'),
            carriedForward: new Prisma.Decimal('0.00'),
            lapsed: new Prisma.Decimal('0.00'),
            lastAccruedMonth: month,
          },
        })
      }

      if (creditAmount.greaterThan(0)) {
        creditedCount++
      } else {
        skippedCount++
      }
    }
  }

  return {
    companyId,
    year,
    month,
    totalEmployees: employees.length,
    processedRecords: processedCount,
    creditedRecords: creditedCount,
    skippedRecords: skippedCount,
  }
}

/**
 * Backfills opening leave balances from LeaveType.daysPerYear.
 * In dry-run mode, computes the exact counts and reports without writing any changes to the database.
 * Never overwrites a non-zero existing balance.
 */
export async function backfillLeaveBalances({
  companyId,
  year,
  dryRun = false,
  tx,
}: BackfillLeaveBalancesParams): Promise<BackfillResult> {
  const client = tx || db

  const employees = await client.employee.findMany({
    where: {
      status: 'ACTIVE',
      assignments: { some: { companyId } },
    },
    select: { id: true },
  })

  const leaveTypes = await client.leaveType.findMany({
    where: {
      companyId,
      isUnpaid: false,
    },
    select: {
      id: true,
      daysPerYear: true,
    },
  })

  let eligibleCount = 0
  let createdCount = 0
  let skippedCount = 0

  for (const emp of employees) {
    for (const lt of leaveTypes) {
      const existing = await client.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: emp.id,
            leaveTypeId: lt.id,
            year,
          },
        },
      })

      // Never overwrite a non-zero existing balance
      const hasNonZeroBalance =
        existing &&
        (existing.credited.greaterThan(0) ||
          existing.used.greaterThan(0) ||
          existing.carriedForward.greaterThan(0))

      if (hasNonZeroBalance) {
        skippedCount++
        continue
      }

      eligibleCount++
      createdCount++

      if (!dryRun) {
        const openingDays = new Prisma.Decimal(lt.daysPerYear.toString())
        if (existing) {
          await client.leaveBalance.update({
            where: { id: existing.id },
            data: { credited: openingDays },
          })
        } else {
          await client.leaveBalance.create({
            data: {
              employeeId: emp.id,
              leaveTypeId: lt.id,
              year,
              credited: openingDays,
              used: new Prisma.Decimal('0.00'),
              carriedForward: new Prisma.Decimal('0.00'),
              lapsed: new Prisma.Decimal('0.00'),
            },
          })
        }
      }
    }
  }

  return {
    companyId,
    year,
    dryRun: !!dryRun,
    totalEmployees: employees.length,
    eligibleRecords: eligibleCount,
    createdRecords: createdCount,
    skippedRecords: skippedCount,
  }
}

