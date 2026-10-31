import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { hashPassword } from '@/lib/password'
import { AUDIT_ACTIONS } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { validateBody, userCreateSchema } from '@/lib/validation'

// POST /api/users - credential provisioning (admin-only)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN'])
    const body = validateBody(userCreateSchema, await req.json())
    const { name, email, role, password, companyId, employeeCode, designation, baseSalary, phone } = body

    const scopedIds = await getScopedCompanyIds(auth)

    // Authorization & Hierarchy Rules
    if (auth.role === 'COMPANY_ADMIN') {
      // Must be within their own company
      assertCompanyInScope(companyId, scopedIds)
      // Cannot create SUPER_ADMIN or COMPANY_ADMIN
      if (role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN') {
        throw new ApiError(403, 'Forbidden: Company Admin can only create HR, Manager, or Employee roles')
      }
      if (!['HR', 'MANAGER', 'EMPLOYEE'].includes(role)) {
        throw new ApiError(400, 'Invalid role for Company Admin provisioning')
      }
    }

    const cleanEmail = email.toLowerCase().trim()
    const existingUser = await db.user.findUnique({ where: { email: cleanEmail } })
    if (existingUser) {
      throw new ApiError(409, 'A user with this email already exists')
    }

    const company = await db.company.findUnique({ where: { id: companyId } })
    if (!company) throw new ApiError(404, 'Company not found')

    let code = employeeCode?.trim()
    if (!code) {
      code = `${company.code}-${Math.floor(1000 + Math.random() * 9000)}`
    }

    if (role !== 'STUDENT') {
      const existingEmp = await db.employee.findUnique({ where: { employeeCode: code } })
      if (existingEmp) {
        throw new ApiError(409, `Employee code ${code} is already in use`)
      }
    }

    const passwordHash = hashPassword(password)

    // Execute all in one transaction
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: cleanEmail,
          name: name.trim(),
          role,
          passwordHash,
          phone: phone ? String(phone).trim() : null,
        },
      })

      // If Admin or HR, populate UserCompanyScope
      if (role === 'COMPANY_ADMIN' || role === 'HR') {
        await tx.userCompanyScope.create({
          data: {
            userId: user.id,
            companyId,
          },
        })
      }

      let employee: any = null
      if (role !== 'STUDENT') {
        employee = await tx.employee.create({
          data: {
            userId: user.id,
            employeeCode: code,
            designation: designation?.trim() || role,
            baseSalary: Number(baseSalary) || 0,
          },
        })

        await tx.employeeCompanyAssignment.create({
          data: {
            employeeId: employee.id,
            companyId,
            isPrimary: true,
            designation: designation?.trim() || role,
          },
        })
      }

      const { passwordHash: _hash, ...safeUser } = user
      await logAudit(tx, auth.userId, AUDIT_ACTIONS.USER_CREATE, 'User', user.id, {
        email: cleanEmail,
        role,
        companyId,
      })
      return { user: safeUser, employee }
    })

    return Response.json({ ok: true, data: result }, { status: 201 })
  })
}
