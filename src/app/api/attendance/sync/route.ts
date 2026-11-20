import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { requireAuth, handle, ApiError } from '@/lib/api-auth'
import { ADMIN_ROLES, ATTENDANCE_STATUS, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { biometricSyncSchema } from '@/lib/validation'
import {
  resolveAttendanceCompanyId,
  resolveShiftForDate,
  classifyDay,
  ShiftResolutionError,
  type ResolvedShift,
} from '@/lib/attendance'

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
  if (body && typeof body === 'object' && 'punches' in body && Array.isArray((body as { punches: unknown }).punches)) {
    if ((body as { punches: unknown[] }).punches.length > 500) {
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

      // Resolve target company ID via resolveAttendanceCompanyId (prioritizes active assignment to punch.companyId, else primary/earliest)
      let targetCompanyId: string
      try {
        targetCompanyId = await resolveAttendanceCompanyId(emp.id, punch.companyId)
      } catch {
        errors.push({ employeeCode: punch.employeeCode, index: i, reason: 'No company assignment found for employee' })
        skipped++
        continue
      }

      // If a specific company was requested in the punch, verify the resolved assignment matches
      if (punch.companyId && targetCompanyId !== punch.companyId) {
        errors.push({
          employeeCode: punch.employeeCode,
          index: i,
          reason: `Company ${punch.companyId} not in employee assignments`,
        })
        skipped++
        continue
      }

      const targetDate = new Date(`${punch.date}T00:00:00.000Z`)

      // Resolve applicable shift for employee on targetDate
      let shift: ResolvedShift
      try {
        const resolved = await resolveShiftForDate(emp.id, targetCompanyId, targetDate, db)
        shift = resolved.shift
      } catch (err) {
        if (err instanceof ShiftResolutionError) {
          errors.push({
            employeeCode: punch.employeeCode,
            index: i,
            reason: 'No shift configured for company',
          })
          skipped++
          continue
        }
        throw err
      }

      // Query holiday for target company and date
      const holiday = await db.holiday.findUnique({
        where: {
          companyId_date: {
            companyId: targetCompanyId,
            date: targetDate,
          },
        },
      })
      const isHoliday = !!holiday

      // Compute isWeekoff from shift/company rule (no weekoff model exists yet -> false per spec)
      const isWeekoff = false

      // Resolve company timezone
      const payRule = await db.companyPayRule.findUnique({ where: { companyId: targetCompanyId } })
      const timeZone = payRule?.timezone || 'Asia/Kolkata'
      const dateKey = punch.date

      // Per-item transaction for atomic merge upsert
      await db.$transaction(async (tx) => {
        const existing = await tx.attendance.findUnique({
          where: {
            employeeId_companyId_date: {
              employeeId: emp.id,
              companyId: targetCompanyId,
              date: targetDate,
            },
          },
        })

        if (!existing) {
          const checkInUtc = punch.checkIn ?? null
          const checkOutUtc = punch.checkOut ?? null

          const classification = classifyDay({
            dateKey,
            isHoliday,
            isWeekoff,
            punches: (checkInUtc || checkOutUtc) ? {
              checkInUtc,
              checkOutUtc,
              source: 'BIOMETRIC',
            } : null,
            shift,
            timeZone,
          })

          const classificationData = {
            status: classification.status,
            lateMinutes: classification.lateMinutes.toNumber(),
            earlyExitMinutes: classification.earlyExitMinutes.toNumber(),
            otMinutes: Math.round(classification.otHours.mul(60).toNumber()),
            isLop: classification.isLop,
            shiftId: shift.id,
            classifiedAt: new Date(),
          }

          await tx.attendance.create({
            data: {
              employeeId: emp.id,
              companyId: targetCompanyId,
              date: targetDate,
              checkIn: punch.checkIn ? new Date(punch.checkIn) : null,
              checkOut: punch.checkOut ? new Date(punch.checkOut) : null,
              source: 'BIOMETRIC',
              ...classificationData,
            },
          })
          created++
        } else {
          // Existing record: fill ONLY empty fields (missing checkIn/checkOut), never overwrite non-null values
          const updateData: Record<string, unknown> = {}
          let fieldsChanged = false

          if (!existing.checkIn && punch.checkIn) {
            updateData.checkIn = new Date(punch.checkIn)
            fieldsChanged = true
          }

          if (!existing.checkOut && punch.checkOut) {
            updateData.checkOut = new Date(punch.checkOut)
            fieldsChanged = true
          }

          if (fieldsChanged) {
            const mergedCheckIn = (updateData.checkIn as Date | undefined) ?? existing.checkIn
            const mergedCheckOut = (updateData.checkOut as Date | undefined) ?? existing.checkOut

            const checkInUtc = mergedCheckIn ? mergedCheckIn.toISOString() : null
            const checkOutUtc = mergedCheckOut ? mergedCheckOut.toISOString() : null

            const classification = classifyDay({
              dateKey,
              isHoliday,
              isWeekoff,
              punches: (checkInUtc || checkOutUtc) ? {
                checkInUtc,
                checkOutUtc,
                source: existing.source ?? 'BIOMETRIC',
              } : null,
              shift,
              timeZone,
            })

            updateData.status = classification.status
            updateData.lateMinutes = classification.lateMinutes.toNumber()
            updateData.earlyExitMinutes = classification.earlyExitMinutes.toNumber()
            updateData.otMinutes = Math.round(classification.otHours.mul(60).toNumber())
            updateData.isLop = classification.isLop
            updateData.shiftId = shift.id
            updateData.classifiedAt = new Date()

            await tx.attendance.update({
              where: {
                employeeId_companyId_date: {
                  employeeId: emp.id,
                  companyId: targetCompanyId,
                  date: targetDate,
                },
              },
              data: updateData,
            })
            updated++
          } else {
            // Duplicate identical push - no-op
            skipped++
          }
        }
      })
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Transaction error'
      errors.push({
        employeeCode: punch.employeeCode,
        index: i,
        reason: errorMsg,
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

