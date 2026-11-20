import { db } from '@/lib/db'
import {
  requireAuth,
  handle,
  ApiError,
  getAdministeredCompanyIds,
  assertCompanyInScope,
} from '@/lib/api-auth'
import { ROLES } from '@/lib/constants'
import { parsePaginationParams } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'

/**
 * GET /api/documents?ownerType=...&ownerId=...&type=...&page=1&pageSize=25
 * Lists documents with strict tenant scoping and pagination.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const { page, pageSize, skip } = parsePaginationParams(url)

    const ownerType = url.searchParams.get('ownerType')
    const ownerId = url.searchParams.get('ownerId')
    const docType = url.searchParams.get('type')

    const where: Prisma.DocumentWhereInput = {}

    if (docType) {
      where.type = docType
    }

    // Authorization & Scoping
    if (ownerType && ownerId) {
      if (ownerType === 'COMPANY') {
        if (auth.role !== ROLES.SUPER_ADMIN) {
          const administeredIds = await getAdministeredCompanyIds(auth)
          assertCompanyInScope(ownerId, administeredIds)
        }
      } else if (ownerType === 'EMPLOYEE') {
        if (auth.role === ROLES.EMPLOYEE) {
          if (auth.employeeId !== ownerId) {
            throw new ApiError(403, 'Forbidden: cannot view documents of another employee')
          }
        } else if (auth.role === ROLES.MANAGER) {
          const isSelf = auth.employeeId === ownerId
          const isReportee = Boolean(
            auth.employeeId &&
              (await db.employee.count({
                where: { id: ownerId, managerId: auth.employeeId },
              })) > 0
          )
          if (!isSelf && !isReportee) {
            throw new ApiError(403, 'Forbidden: cannot view documents outside direct reports')
          }
        } else if (auth.role === ROLES.COMPANY_ADMIN || auth.role === ROLES.HR) {
          const administeredIds = await getAdministeredCompanyIds(auth)
          const inScope = (
            await db.employeeCompanyAssignment.count({
              where: { employeeId: ownerId, companyId: { in: administeredIds ?? [] } },
            })
          ) > 0
          if (!inScope) {
            throw new ApiError(403, 'Forbidden: employee outside administered companies')
          }
        }
      } else if (ownerType === 'STUDENT') {
        if (auth.role === ROLES.STUDENT) {
          const student = await db.student.findFirst({ where: { userId: auth.userId } })
          if (!student || student.id !== ownerId) {
            throw new ApiError(403, 'Forbidden: cannot view other student documents')
          }
        }
      }
      where.ownerType = ownerType
      where.ownerId = ownerId
    } else {
      // General list without specific owner: scope by caller
      if (auth.role === ROLES.SUPER_ADMIN) {
        // all visible
      } else if (auth.role === ROLES.COMPANY_ADMIN || auth.role === ROLES.HR) {
        const administeredIds = await getAdministeredCompanyIds(auth)
        if (!administeredIds || administeredIds.length === 0) {
          return Response.json({ ok: true, data: [], total: 0, page, pageSize })
        }
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
        where.ownerType = 'EMPLOYEE'
        where.ownerId = { in: visibleEmployeeIds }
      } else if (auth.role === ROLES.EMPLOYEE) {
        if (!auth.employeeId) {
          return Response.json({ ok: true, data: [], total: 0, page, pageSize })
        }
        where.ownerType = 'EMPLOYEE'
        where.ownerId = auth.employeeId
      } else if (auth.role === ROLES.STUDENT) {
        where.uploadedBy = auth.userId
      }
    }

    const [total, documents] = await Promise.all([
      db.document.count({ where }),
      db.document.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          uploader: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
    ])

    return Response.json({
      ok: true,
      data: documents,
      page,
      pageSize,
      total,
    })
  })
}
