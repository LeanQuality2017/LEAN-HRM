import type { PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import type { ShiftLike } from './timezone'

export class ShiftResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShiftResolutionError'
  }
}

export interface ResolvedShift extends ShiftLike {
  id: string
  companyId: string
  name: string
  isDefault?: boolean
}

export interface ShiftResolutionResult {
  shift: ResolvedShift
  source: 'ASSIGNMENT' | 'DEFAULT'
}

export type ShiftResolverClient =
  | Pick<PrismaClient, 'employeeShiftAssignment' | 'shift'>
  | {
      employeeShiftAssignment: {
        findFirst: (args: {
          where: {
            employeeId: string
            effectiveFrom: { lte: Date }
            OR?: Array<{ effectiveTo: null } | { effectiveTo: { gte: Date } }>
            shift?: { companyId: string }
          }
          orderBy?: { effectiveFrom: 'asc' | 'desc' } | Array<{ effectiveFrom: 'asc' | 'desc' }>
          include?: { shift: boolean }
        }) => Promise<{ shift: ResolvedShift } | null>
      }
      shift: {
        findFirst: (args: {
          where: {
            companyId: string
            isDefault: boolean
          }
        }) => Promise<ResolvedShift | null>
      }
    }

/**
 * Resolves the applicable Shift for an employee on a given date:
 * 1. An active EmployeeShiftAssignment covering `date` for that company.
 * 2. Fallback to the company's default shift (isDefault = true).
 * 3. Throws ShiftResolutionError if neither is found.
 */
export async function resolveShiftForDate(
  employeeId: string,
  companyId: string,
  date: Date | string,
  client: ShiftResolverClient = db
): Promise<ShiftResolutionResult> {
  const targetDate = typeof date === 'string' ? new Date(date) : date

  // 1. Check for specific shift assignment covering date
  const assignment = await client.employeeShiftAssignment.findFirst({
    where: {
      employeeId,
      effectiveFrom: { lte: targetDate },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gte: targetDate } },
      ],
      shift: { companyId },
    },
    orderBy: { effectiveFrom: 'desc' },
    include: { shift: true },
  })

  if (assignment?.shift) {
    return {
      shift: assignment.shift,
      source: 'ASSIGNMENT',
    }
  }

  // 2. Fallback to company's default shift
  const defaultShift = await client.shift.findFirst({
    where: {
      companyId,
      isDefault: true,
    },
  })

  if (defaultShift) {
    return {
      shift: defaultShift,
      source: 'DEFAULT',
    }
  }

  // 3. Neither found
  throw new ShiftResolutionError(
    `No shift assigned or default shift found for employee ${employeeId} at company ${companyId}`
  )
}
