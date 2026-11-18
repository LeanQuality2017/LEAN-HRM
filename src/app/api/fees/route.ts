import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertInstituteInScope } from '@/lib/api-auth'
import { isInstituteEnabled } from '@/lib/feature-gates'
import { PAYMENT_METHODS, AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, feeCreateSchema } from '@/lib/validation'

// POST /api/fees - record fee payment with auto invoice number
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'])
    if (!isInstituteEnabled()) {
      throw new ApiError(403, 'Institute module is disabled outside approved demo environments')
    }
    const scopedIds = await getScopedCompanyIds(auth)
    await assertInstituteInScope(scopedIds)

    const body = validateBody(feeCreateSchema, await req.json())
    const amount = Number(body.amount)
    const method = body.method ?? 'CASH'

    const student = await db.student.findUnique({ where: { id: body.studentId } })
    if (!student) throw new ApiError(404, 'Student not found')

    let invoiceNo = body.invoiceNo?.trim()
    if (!invoiceNo) {
      const seq = (await db.feePayment.count()) + 1
      invoiceNo = `INV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}-${Math.floor(100 + Math.random() * 900)}`
    } else {
      const existing = await db.feePayment.findUnique({ where: { invoiceNo } })
      if (existing) throw new ApiError(409, `Invoice number ${invoiceNo} already exists`)
    }

    const payment = await db.$transaction(async (tx) => {
      const p = await tx.feePayment.create({
        data: {
          studentId: body.studentId,
          amount,
          method,
          invoiceNo,
          note: body.note ?? null,
          receivedById: auth.userId,
        },
      })

      if (student.userId) {
        await tx.notification.create({
          data: {
            userId: student.userId,
            title: 'Fee payment received',
            message: `₹${amount} received (${invoiceNo}). Thank you.`,
            link: '/profile',
          },
        })
      }

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.FEE_CREATE, 'FeePayment', p.id, {
        studentId: body.studentId,
        amount,
        method,
        invoiceNo,
      })

      return p
    })

    return Response.json({ ok: true, data: { ...payment, amount: Number(payment.amount) } }, { status: 201 })
  })
}
