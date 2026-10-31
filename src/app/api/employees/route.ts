import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getScopedCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES, AUDIT_ACTIONS } from '@/lib/constants'
import { hashPassword } from '@/lib/password'
import { logAudit } from '@/lib/audit'
import { validateBody, employeeCreateSchema, employeeUpdateSchema, roleEnum, shortString } from '@/lib/validation'
import { z } from 'zod'

// GET /api/employees - list scoped employees (?companyId=)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const companyId = url.searchParams.get('companyId')
    const q = url.searchParams.get('q')

    const scopedIds = await getScopedCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, scopedIds)
    }

    const where: Record<string, unknown> = {}
    if (companyId) {
      where.assignments = { some: { companyId } }
    } else if (scopedIds) {
      where.assignments = { some: { companyId: { in: scopedIds } } }
    }

    if (q) {
      where.OR = [
        { employeeCode: { contains: q, mode: 'insensitive' } },
        { designation: { contains: q, mode: 'insensitive' } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ]
    }

    const data = await db.employee.findMany({
      where,
      orderBy: { employeeCode: 'asc' },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, phone: true, isActive: true } },
        assignments: { include: { company: { select: { id: true, name: true, code: true } } } },
      },
    })

    const canSeeSalaries = HR_ROLES.includes(auth.role)
    const sanitized = data.map((emp) => {
      if (canSeeSalaries) {
        return { ...emp, baseSalary: Number(emp.baseSalary) }
      }
      const { baseSalary: _sal, ...rest } = emp
      return rest
    })

    return Response.json({ ok: true, data: sanitized })
  })
}

// POST /api/employees - create employee with login (HR+)
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const body = validateBody(employeeCreateSchema, await req.json())

    // Role assignment rules:
    // SUPER_ADMIN may assign any role.
    // COMPANY_ADMIN may create only HR/MANAGER/EMPLOYEE within own scope.
    // Any attempt by HR or lower to specify role -> 403.
    const targetRole = body.role ?? 'EMPLOYEE'
    if (auth.role === 'SUPER_ADMIN') {
      // Allowed
    } else if (auth.role === 'COMPANY_ADMIN') {
      if (!['HR', 'MANAGER', 'EMPLOYEE'].includes(targetRole)) {
        throw new ApiError(403, 'Forbidden: Company Admin may create only HR, Manager, or Employee roles')
      }
    } else {
      if (body.role && body.role !== 'EMPLOYEE') {
        throw new ApiError(403, 'Forbidden: HR cannot specify user roles')
      }
    }

    if (!body.name || !body.email || !body.password || !body.companyId || !body.employeeCode) {
      throw new ApiError(400, 'name, email, password, companyId, employeeCode required')
    }

    const scopedIds = await getScopedCompanyIds(auth)
    assertCompanyInScope(body.companyId, scopedIds)

    const companyIds: string[] = Array.isArray(body.companyIds) && body.companyIds.length ? body.companyIds : [body.companyId]
    for (const cid of companyIds) {
      assertCompanyInScope(cid, scopedIds)
    }

    const email = body.email.toLowerCase().trim()
    const exists = await db.user.findUnique({ where: { email } })
    if (exists) throw new ApiError(409, 'A user with this email already exists')
    const codeExists = await db.employee.findUnique({ where: { employeeCode: body.employeeCode } })
    if (codeExists) throw new ApiError(409, 'Employee code already in use')

    // Wrapped in transaction
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: body.name,
          passwordHash: hashPassword(body.password),
          role: targetRole,
          phone: body.phone ?? null,
        },
      })
      const employee = await tx.employee.create({
        data: {
          userId: user.id,
          employeeCode: body.employeeCode,
          designation: body.designation ?? 'Employee',
          baseSalary: Number(body.baseSalary) || 0,
          joinedAt: body.joinedAt ? new Date(body.joinedAt) : new Date(),
          managerId: body.managerId || null,
        },
      })

      await tx.employeeCompanyAssignment.createMany({
        data: companyIds.map((cid: string, i: number) => ({ employeeId: employee.id, companyId: cid, isPrimary: i === 0 })),
      })

      await logAudit(tx, auth.userId, AUDIT_ACTIONS.EMPLOYEE_CREATE, 'Employee', employee.id, {
        employeeCode: body.employeeCode,
        role: targetRole,
        companyIds,
      })

      return { userId: user.id, employeeId: employee.id }
    })

    return Response.json({ ok: true, data: result })
  })
}

// PATCH /api/employees?id= - update employee/user/assignments (HR+)
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth(HR_ROLES)
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) throw new ApiError(400, 'id required')
    const body = validateBody(employeeUpdateSchema, await req.json())

    const scopedIds = await getScopedCompanyIds(auth)
    const employee = await db.employee.findUnique({
      where: { id },
      include: { assignments: true },
    })
    if (!employee) throw new ApiError(404, 'Employee not found')

    if (scopedIds) {
      const hasScopedCompany = employee.assignments.some((a) => scopedIds.includes(a.companyId))
      if (!hasScopedCompany) {
        throw new ApiError(403, 'Forbidden: employee out of scope')
      }
    }

    if (Array.isArray(body.companyIds) && body.companyIds.length) {
      for (const cid of body.companyIds) {
        assertCompanyInScope(cid, scopedIds)
      }
    }

    // Role changes check:
    // Only SUPER_ADMIN can change any role.
    // COMPANY_ADMIN may patch only HR/MANAGER/EMPLOYEE, and cannot modify Admin accounts.
    // HR or lower -> 403 on any role modification attempt.
    if (body.role !== undefined) {
      if (auth.role === 'SUPER_ADMIN') {
        // Allowed
      } else if (auth.role === 'COMPANY_ADMIN') {
        if (!['HR', 'MANAGER', 'EMPLOYEE'].includes(body.role)) {
          throw new ApiError(403, 'Forbidden: Company Admin may patch only HR, Manager, or Employee roles')
        }
        const targetUser = await db.user.findUnique({ where: { id: employee.userId } })
        if (targetUser?.role === 'SUPER_ADMIN' || targetUser?.role === 'COMPANY_ADMIN') {
          throw new ApiError(403, 'Forbidden: Cannot modify Admin accounts')
        }
      } else {
        throw new ApiError(403, 'Forbidden: HR cannot modify user roles')
      }
    }

    await db.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id },
        data: {
          designation: body.designation ?? undefined,
          baseSalary: body.baseSalary != null ? Number(body.baseSalary) : undefined,
          status: body.status ?? undefined,
          managerId: body.managerId !== undefined ? (body.managerId || null) : undefined,
        },
      })

      const userUpdate: Record<string, unknown> = {}
      if (body.name) userUpdate.name = body.name
      if (body.phone !== undefined) userUpdate.phone = body.phone
      if (body.role !== undefined) userUpdate.role = body.role
      if (body.isActive !== undefined) userUpdate.isActive = Boolean(body.isActive)
      if (body.password) {
        userUpdate.passwordHash = hashPassword(body.password)
      }
      if (Object.keys(userUpdate).length) {
        await tx.user.update({ where: { id: employee.userId }, data: userUpdate })
      }
      if (Array.isArray(body.companyIds) && body.companyIds.length) {
        await tx.employeeCompanyAssignment.deleteMany({ where: { employeeId: id } })
        await tx.employeeCompanyAssignment.createMany({
          data: body.companyIds.map((cid: string, i: number) => ({ employeeId: id, companyId: cid, isPrimary: i === 0 })),
        })
      }

      if (body.role !== undefined) {
        await logAudit(tx, auth.userId, AUDIT_ACTIONS.USER_ROLE_CHANGE, 'User', employee.userId, {
          employeeId: id,
          newRole: body.role,
        })
      }
      if (body.isActive === false) {
        await logAudit(tx, auth.userId, AUDIT_ACTIONS.USER_DEACTIVATE, 'User', employee.userId, {
          employeeId: id,
        })
      }
    })
    return Response.json({ ok: true })
  })
}
