import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { requireAuth, handle, ApiError } from '@/lib/api-auth'
import { ADMIN_ROLES, ATTENDANCE_STATUS, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { biometricSyncSchema } from '@/lib/validation'

// NOTE: POST /api/attendance/sync is a machine-to-machine biometric device endpoint
// exempt from NextAuth session authentication BY DESIGN; authenticated exclusively via x-api-key header.

// Timing-safe constant-time API key verification
function verifyApiKey(req: Request): boolean {
  const headerKey = req.headers.get('x-api-key')
  const envKey = process.env.BIOMETRIC_API_KEY
  if (!headerKey || !envKey) return false

  const bufA = Buffer.from(headerKey, 'utf-8')
  const bufB = Buffer.from(envKey, 'utf-8')
  if (bufA.length !== bufB.length) return false

  return crypto.timingSafeEqual(bufA, bufB)
}

function isCheckInLate(checkInStr: string): boolean {
  const match = checkInStr.match(/T(\d{2}):(\d{2})/)
  if (match) {
    const hours = parseInt(match[1], 10)
    const mins = parseInt(match[2], 10)
    return hours * 60 + mins >= 9 * 60 + 30
  }
  const d = new Date(checkInStr)
  return d.getHours() * 60 + d.getMinutes() >= 9 * 60 + 30
}

// POST /api/attendance/sync - device biometric attendance push
export async function POST(req: Request) {
  // Constant-time key check; never echo key or internal reason
  if (!verifyApiKey(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Pre-check for batch size cap > 500
  if (body && typeof body === 'object' && 'punches' in body && Array.isArray((body as any).punches)) {
    if ((body as any).punches.length > 500) {
      return Response.json({ error: 'Batch size exceeds maximum limit of 500 punches' }, { status: 400 })
    }
  }

  const parsed = biometricSyncSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : ''
    return Response.json({ error: `${path}${issue?.message || 'Invalid input'}` }, { status: 400 })
  }

  const { punches } = parsed.data
  let created = 0
  let updated = 0
  let skipped = 0
  const errors: Array<{ employeeCode: string; index: number; reason: string }> = []

  // Process punches per-item: individual row isolation ensures one bad row does not fail the batch
  for (let i = 0; i < punches.length; i++) {
    const punch = punches[i]

    try {
      const emp = await db.employee.findUnique({
        where: { employeeCode: punch.employeeCode },
        include: { assignments: true },
      })

      if (!emp) {
        errors.push({ employeeCode: punch.employeeCode, index: i, reason: 'Employee not found' })
        skipped++
        continue
      }

      const primaryAssignment = emp.assignments.find((a) => a.isPrimary) || emp.assignments[0]
      if (!primaryAssignment) {
        errors.push({ employeeCode: punch.employeeCode, index: i, reason: 'No company assignment found for employee' })
        skipped++
        continue
      }

      let targetCompanyId = punch.companyId
      if (!targetCompanyId) {
        targetCompanyId = primaryAssignment.companyId
      } else {
        const isAssigned = emp.assignments.some((a) => a.companyId === targetCompanyId)
        if (!isAssigned) {
          errors.push({
            employeeCode: punch.employeeCode,
            index: i,
            reason: `Company ${targetCompanyId} not in employee assignments`,
          })
          skipped++
          continue
        }
      }

      const targetDate = new Date(`${punch.date}T00:00:00.000Z`)

      // Per-item transaction for atomic merge upsert
      await db.$transaction(async (tx) => {
        const existing = await tx.attendance.findUnique({
          where: {
            employeeId_date: {
              employeeId: emp.id,
              date: targetDate,
            },
          },
        })

        if (!existing) {
          const status = punch.checkIn
            ? isCheckInLate(punch.checkIn)
              ? ATTENDANCE_STATUS.LATE
              : ATTENDANCE_STATUS.PRESENT
            : ATTENDANCE_STATUS.PRESENT

          await tx.attendance.create({
            data: {
              employeeId: emp.id,
              companyId: targetCompanyId!,
              date: targetDate,
              checkIn: punch.checkIn ? new Date(punch.checkIn) : null,
              checkOut: punch.checkOut ? new Date(punch.checkOut) : null,
              status,
              source: 'BIOMETRIC',
            },
          })
          created++
        } else {
          // Existing record: fill ONLY empty fields (missing checkIn/checkOut), never overwrite non-null values
          const updateData: Record<string, unknown> = {}
          let fieldsChanged = false

          let newCheckIn: Date | null = null
          if (!existing.checkIn && punch.checkIn) {
            newCheckIn = new Date(punch.checkIn)
            updateData.checkIn = newCheckIn
            fieldsChanged = true
          }

          if (!existing.checkOut && punch.checkOut) {
            updateData.checkOut = new Date(punch.checkOut)
            fieldsChanged = true
          }

          // Keep existing status unless both punches now exist and status was default-derived
          if (newCheckIn && punch.checkIn) {
            const isLate = isCheckInLate(punch.checkIn)
            if (isLate && existing.status === ATTENDANCE_STATUS.PRESENT) {
              updateData.status = ATTENDANCE_STATUS.LATE
              fieldsChanged = true
            }
          }

          if (fieldsChanged) {
            await tx.attendance.update({
              where: { id: existing.id },
              data: updateData,
            })
            updated++
          } else {
            // Duplicate identical push - no-op
            skipped++
          }
        }
      })
    } catch (err: any) {
      errors.push({
        employeeCode: punch.employeeCode,
        index: i,
        reason: err?.message || 'Transaction error',
      })
      skipped++
    }
  }

  // Single logAudit row per sync call recording summary counts only
  const systemUser = await db.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true },
  })
  if (systemUser) {
    await logAudit(db, systemUser.id, AUDIT_ACTIONS.ATTENDANCE_SYNC, 'Attendance', null, {
      total: punches.length,
      created,
      updated,
      skipped,
      errorCount: errors.length,
    })
  }

  return Response.json({
    created,
    updated,
    skipped,
    errors,
  })
}

// GET /api/attendance/sync - list last 20 sync audit events (admin-only)
export async function GET() {
  return handle(async () => {
    await requireAuth(ADMIN_ROLES)

    const data = await db.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.ATTENDANCE_SYNC },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    })

    return Response.json({ ok: true, data })
  })
}

