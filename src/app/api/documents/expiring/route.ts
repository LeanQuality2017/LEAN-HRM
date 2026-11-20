import { db } from '@/lib/db'
import {
  requireAuth,
  handle,
  getAdministeredCompanyIds,
} from '@/lib/api-auth'
import { ROLES } from '@/lib/constants'
import type { Prisma } from '@prisma/client'

/**
 * GET /api/documents/expiring?days=30&includeExpired=false
 * Returns documents approaching expiration (or already expired) within a specified window.
 * Strictly tenant-scoped based on the authenticated user's role and assignments.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const rawDays = parseInt(url.searchParams.get('days') || '30', 10)
    const days = Math.min(365, Math.max(1, isNaN(rawDays) ? 30 : rawDays))
    const includeExpired = url.searchParams.get('includeExpired') === 'true'

    const now = new Date()
    const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

    const expiryFilter: Prisma.DateTimeFilter = includeExpired
      ? { lte: horizon }
      : { gte: now, lte: horizon }

    const where: Prisma.DocumentWhereInput = {
      expiryDate: expiryFilter,
    }

    if (auth.role === ROLES.SUPER_ADMIN) {
      // Global visibility: no additional tenant filter
    } else if (auth.role === ROLES.COMPANY_ADMIN || auth.role === ROLES.HR) {
      const administeredIds = await getAdministeredCompanyIds(auth)
      if (!administeredIds || administeredIds.length === 0) {
        return Response.json({ ok: true, data: [], count: 0 })
      }

      // Collect all employees assigned to administered companies
      const employeeIds = (
        await db.employeeCompanyAssignment.findMany({
          where: { companyId: { in: administeredIds } },
          select: { employeeId: true },
        })
      ).map((a) => a.employeeId)

      where.OR = [
        { ownerType: 'COMPANY', ownerId: { in: administeredIds } },
        { ownerType: 'EMPLOYEE', ownerId: { in: employeeIds } },
      ]
    } else if (auth.role === ROLES.MANAGER) {
      const reporteeIds = auth.employeeId
        ? (
            await db.employee.findMany({
              where: { managerId: auth.employeeId },
              select: { id: true },
            })
          ).map((e) => e.id)
        : []

      const visibleEmployeeIds = auth.employeeId ? [auth.employeeId, ...reporteeIds] : []
      if (visibleEmployeeIds.length === 0) {
        return Response.json({ ok: true, data: [], count: 0 })
      }

      where.ownerType = 'EMPLOYEE'
      where.ownerId = { in: visibleEmployeeIds }
    } else if (auth.role === ROLES.EMPLOYEE) {
      if (!auth.employeeId) {
        return Response.json({ ok: true, data: [], count: 0 })
      }
      where.ownerType = 'EMPLOYEE'
      where.ownerId = auth.employeeId
    } else if (auth.role === ROLES.STUDENT) {
      where.uploadedBy = auth.userId
    } else {
      return Response.json({ ok: true, data: [], count: 0 })
    }

    const documents = await db.document.findMany({
      where,
      orderBy: { expiryDate: 'asc' },
      include: {
        uploader: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    })

    return Response.json({
      ok: true,
      data: documents,
      count: documents.length,
      windowDays: days,
    })
  })
}
