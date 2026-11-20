import { db } from '@/lib/db'

export class AttendanceScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttendanceScopeError'
  }
}

interface AssignmentClient {
  employeeCompanyAssignment: {
    findMany: (args: {
      where: { employeeId: string }
      orderBy?: Array<{ isPrimary?: 'asc' | 'desc'; id?: 'asc' | 'desc' }> | { isPrimary?: 'asc' | 'desc'; id?: 'asc' | 'desc' }
      select?: { companyId?: boolean; isPrimary?: boolean }
    }) => Promise<Array<{ companyId: string; isPrimary: boolean }>>
  }
}

/**
 * TEMPORARY: legacy unique [employeeId, date] is still active; this helper
 * guarantees single-row-per-date-per-employee until step 4.3 drops it.
 *
 * Resolves the target companyId for an attendance write or lookup:
 * 1. If requestedCompanyId is provided and the employee has an active assignment to it -> return it.
 * 2. Otherwise return the primary assignment's companyId (isPrimary = true).
 * 3. If no primary assignment exists, fall back deterministically to the earliest assignment.
 * 4. Throws AttendanceScopeError if employee has no company assignments.
 */
export async function resolveAttendanceCompanyId(
  employeeId: string,
  requestedCompanyId?: string | null,
  client: AssignmentClient = db
): Promise<string> {
  const assignments = await client.employeeCompanyAssignment.findMany({
    where: { employeeId },
    orderBy: [
      { isPrimary: 'desc' },
      { id: 'asc' }, // deterministic earliest assignment if no primary flag set
    ],
    select: {
      companyId: true,
      isPrimary: true,
    },
  })

  if (!assignments || assignments.length === 0) {
    throw new AttendanceScopeError(`Employee ${employeeId} has no company assignments`)
  }

  if (requestedCompanyId) {
    const match = assignments.find((a) => a.companyId === requestedCompanyId)
    if (match) {
      return match.companyId
    }
  }

  // Fall back to primary assignment, or earliest assignment deterministically
  const primary = assignments.find((a) => a.isPrimary) ?? assignments[0]
  return primary.companyId
}

