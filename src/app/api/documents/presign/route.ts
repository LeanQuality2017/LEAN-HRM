import { db } from '@/lib/db'
import {
  requireAuth,
  handle,
  ApiError,
  getAdministeredCompanyIds,
  getEmployedCompanyIds,
  getScopedCompanyIds,
  assertCompanyInScope,
  assertInstituteInScope,
} from '@/lib/api-auth'
import { ROLES, HR_ROLES, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import {
  validateDocumentUpload,
  generateDocumentFileKey,
  generatePresignedPutUrl,
} from '@/lib/s3'

/**
 * POST /api/documents/presign
 * Generates an S3/compatible presigned PUT upload URL and initializes a Document record.
 * Validates MIME type and file size server-side.
 * Strictly tenant-scoped: verifies caller has authority over ownerType & ownerId.
 * Never proxies raw file bytes through the Next.js application server.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const body = await req.json().catch(() => ({}))

    let validated
    try {
      validated = validateDocumentUpload(body)
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : 'Invalid document upload parameters')
    }

    // Tenant and Resource Authorization checks
    if (validated.ownerType === 'COMPANY') {
      if (auth.role !== ROLES.SUPER_ADMIN && auth.role !== ROLES.COMPANY_ADMIN && auth.role !== ROLES.HR) {
        throw new ApiError(403, 'Forbidden: only administrative roles can attach company documents')
      }
      const administeredIds = await getAdministeredCompanyIds(auth)
      assertCompanyInScope(validated.ownerId, administeredIds)

      const company = await db.company.findUnique({
        where: { id: validated.ownerId },
        select: { id: true },
      })
      if (!company) {
        throw new ApiError(404, 'Company not found')
      }
    } else if (validated.ownerType === 'EMPLOYEE') {
      const employee = await db.employee.findUnique({
        where: { id: validated.ownerId },
        include: {
          assignments: { select: { companyId: true } },
        },
      })
      if (!employee) {
        throw new ApiError(404, 'Employee not found')
      }

      if (auth.role === ROLES.EMPLOYEE) {
        if (auth.employeeId !== validated.ownerId) {
          throw new ApiError(403, 'Forbidden: employees may only upload documents for their own profile')
        }
      } else if (auth.role === ROLES.MANAGER) {
        const isSelf = auth.employeeId === validated.ownerId
        const isReportee = Boolean(auth.employeeId && employee.managerId === auth.employeeId)
        if (!isSelf && !isReportee) {
          throw new ApiError(403, 'Forbidden: managers can only upload documents for themselves or direct reports')
        }
        const employedIds = await getEmployedCompanyIds(auth)
        const hasCompanyIntersection = employee.assignments.some((a) => employedIds.includes(a.companyId))
        if (!hasCompanyIntersection) {
          throw new ApiError(403, 'Forbidden: employee outside your company assignment scope')
        }
      } else if (auth.role === ROLES.COMPANY_ADMIN || auth.role === ROLES.HR) {
        const administeredIds = await getAdministeredCompanyIds(auth)
        if (!administeredIds) {
          throw new ApiError(403, 'Forbidden: no administered companies')
        }
        const hasCompanyIntersection = employee.assignments.some((a) => administeredIds.includes(a.companyId))
        if (!hasCompanyIntersection) {
          throw new ApiError(403, 'Forbidden: employee does not belong to any administered company')
        }
      } else if (auth.role !== ROLES.SUPER_ADMIN) {
        throw new ApiError(403, 'Forbidden: insufficient role for employee document upload')
      }
    } else if (validated.ownerType === 'AUDIT') {
      if (!HR_ROLES.includes(auth.role)) {
        throw new ApiError(403, 'Forbidden: only HR or Admin can attach audit documents')
      }
      const auditLog = await db.auditLog.findUnique({
        where: { id: validated.ownerId },
        select: { id: true },
      })
      if (!auditLog) {
        throw new ApiError(404, 'Audit record not found')
      }
    } else if (validated.ownerType === 'STUDENT') {
      if (auth.role === ROLES.STUDENT) {
        const student = await db.student.findFirst({
          where: { userId: auth.userId },
          select: { id: true },
        })
        if (!student || student.id !== validated.ownerId) {
          throw new ApiError(403, 'Forbidden: students can only upload their own documents')
        }
      } else {
        const scopedIds = await getScopedCompanyIds(auth)
        await assertInstituteInScope(scopedIds)
        const student = await db.student.findUnique({
          where: { id: validated.ownerId },
          select: { id: true },
        })
        if (!student) {
          throw new ApiError(404, 'Student not found')
        }
      }
    }

    // Generate unique, collision-resistant object storage key
    const fileKey = generateDocumentFileKey(
      validated.ownerType,
      validated.ownerId,
      validated.type,
      validated.fileName
    )

    // Generate S3 SigV4 direct PUT presigned URL
    const presigned = generatePresignedPutUrl(fileKey, validated.mime)

    // Persist Document metadata record in database
    const document = await db.document.create({
      data: {
        ownerType: validated.ownerType,
        ownerId: validated.ownerId,
        type: validated.type,
        expiryDate: validated.expiryDate,
        fileKey,
        fileName: validated.fileName,
        mime: validated.mime,
        size: validated.size,
        uploadedBy: auth.userId,
      },
    })

    // Audit log
    await logAudit(
      db,
      auth.userId,
      AUDIT_ACTIONS.DOCUMENT_UPLOAD,
      'Document',
      document.id,
      {
        ownerType: validated.ownerType,
        ownerId: validated.ownerId,
        type: validated.type,
        fileName: validated.fileName,
        size: validated.size,
        mime: validated.mime,
        fileKey,
      }
    )

    return Response.json({
      ok: true,
      data: {
        document,
        uploadUrl: presigned.uploadUrl,
        fileKey: presigned.fileKey,
        headers: presigned.headers,
        expiresInSeconds: presigned.expiresInSeconds,
      },
    })
  })
}
