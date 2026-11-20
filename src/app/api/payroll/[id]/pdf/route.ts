import { requireAuth, handle, ApiError, getScopedCompanyIds } from '@/lib/api-auth'
import { isPayrollEnabled } from '@/lib/feature-gates'
import { HR_ROLES, ROLES } from '@/lib/constants'
import { loadPayslipRecord, mapPayslipData, generatePayslipPdf } from '@/lib/payroll/payslip-doc'

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const auth = await requireAuth()
    if (!isPayrollEnabled()) {
      throw new ApiError(403, 'Payroll module is not enabled')
    }

    const { id } = await props.params
    if (!id) {
      throw new ApiError(400, 'id is required')
    }

    // Reuse existing payslip data path without query duplication
    const record = await loadPayslipRecord(id)
    if (!record) {
      throw new ApiError(404, 'Payslip not found')
    }

    // Authorization check
    const isOwner = record.employee?.userId === auth.userId
    const isSuperAdmin = auth.role === ROLES.SUPER_ADMIN
    const isHrOrAdmin = HR_ROLES.includes(auth.role)

    let isAuthorized = false
    if (isSuperAdmin) {
      isAuthorized = true
    } else if (isHrOrAdmin) {
      const scopedIds = await getScopedCompanyIds(auth)
      const empCompanyIds = record.employee?.assignments?.map((a: any) => a.companyId) || []
      if (!scopedIds || empCompanyIds.some((cid: string) => scopedIds.includes(cid))) {
        isAuthorized = true
      }
    } else if (isOwner && auth.role !== ROLES.MANAGER) {
      isAuthorized = true
    }

    if (!isAuthorized) {
      throw new ApiError(403, 'Forbidden: not authorized to view this payslip')
    }

    // Map pure payslip render data
    const renderData = mapPayslipData(record)

    // Generate server-side PDF
    const pdfBuffer = generatePayslipPdf(renderData)

    const fileName = `payslip-${renderData.employee.code}-${renderData.period.month}-${renderData.period.year}.pdf`

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    })
  })
}
