import { db } from '@/lib/db'
import { requireAuth, handle, ApiError, getAdministeredCompanyIds, assertCompanyInScope } from '@/lib/api-auth'
import { HR_ROLES, AUDIT_ACTIONS } from '@/lib/constants'
import { hashPassword } from '@/lib/password'
import { logAudit } from '@/lib/audit'
import { validateBody, employeeCreateSchema, employeeUpdateSchema } from '@/lib/validation'

// GET /api/employees - list scoped employees (?companyId=)
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth()
    const url = new URL(req.url)
    const companyId = url.searchParams.get('companyId')
    const q = url.searchParams.get('q')

    const administeredIds = await getAdministeredCompanyIds(auth)
    if (companyId) {
      assertCompanyInScope(companyId, administeredIds)
    }

    const where: Record<string, unknown> = {}
    if (companyId) {
      where.assignments = { some: { companyId } }
    } else if (administeredIds) {
      where.assignments = { some: { companyId: { in: administeredIds } } }
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

    const administeredIds = await getAdministeredCompanyIds(auth)
    assertCompanyInScope(body.companyId, administeredIds)

    const companyIds: string[] = Array.isArray(body.companyIds) && body.companyIds.length ? body.companyIds : [body.companyId]
    for (const cid of companyIds) {
      assertCompanyInScope(cid, administeredIds)
    }

    // Strict Administrative Scope Provisioning:
    // When creating HR or COMPANY_ADMIN, require explicit administeredCompanyIds array
    let adminScopes: string[] = []
    if (targetRole === 'COMPANY_ADMIN' || targetRole === 'HR') {
      if (!Array.isArray(body.administeredCompanyIds) || body.administeredCompanyIds.length === 0) {
        throw new ApiError(400, 'administeredCompanyIds array is required when creating administrative roles')
      }
      adminScopes = Array.from(new Set(body.administeredCompanyIds))
      for (const cid of adminScopes) {
        assertCompanyInScope(cid, administeredIds)
      }
    }

    if (!body.designation || !body.designation.trim()) {
      throw new ApiError(400, 'Designation is required.')
    }

    const email = body.email.toLowerCase().trim()
    const exists = await db.user.findUnique({ where: { email } })
    if (exists) throw new ApiError(409, 'A user with this email already exists')
    const codeExists = await db.employee.findUnique({ where: { employeeCode: body.employeeCode } })
    if (codeExists) throw new ApiError(409, 'Employee code already in use')

    if (body.phone && body.phone.trim()) {
      const phoneExists = await db.user.findFirst({ where: { phone: body.phone.trim() } })
      if (phoneExists) throw new ApiError(409, 'Phone number already exists.')
    }

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

      // Transactionally populate UserCompanyScope for administrative accounts
      if (targetRole === 'COMPANY_ADMIN' || targetRole === 'HR') {
        await tx.userCompanyScope.createMany({
          data: adminScopes.map((cid: string) => ({
            userId: user.id,
            companyId: cid,
          })),
        })
      }

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
        administeredCompanyIds: adminScopes.length > 0 ? adminScopes : undefined,
      })

      return { userId: user.id, employeeId: employee.id }
    })

    return Response.json({ ok: true, data: result }, { status: 201 })
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

    const administeredIds = await getAdministeredCompanyIds(auth)
    const employee = await db.employee.findUnique({
      where: { id },
      include: { assignments: true, user: true },
    })
    if (!employee) throw new ApiError(404, 'Employee not found')

    // Section 6.C: Target Current Company Verification
    // Verify that the employee currently belongs to at least one company within caller's administered scope
    if (administeredIds) {
      const hasCurrentAdministeredCompany = employee.assignments.some((a) => administeredIds.includes(a.companyId))
      if (!hasCurrentAdministeredCompany) {
        throw new ApiError(403, 'Forbidden: employee out of administrative scope')
      }
    }

    // Validate any proposed new employment company assignments against caller's administered scope
    if (Array.isArray(body.companyIds) && body.companyIds.length) {
      for (const cid of body.companyIds) {
        assertCompanyInScope(cid, administeredIds)
      }
    }

    // Section 7: NEW-01 Self-Edit Restrictions (HR + COMPANY_ADMIN)
    // HR and COMPANY_ADMIN users must not edit their own sensitive employee fields through administrative management endpoints
    const isSelf = auth.userId === employee.userId || (auth.employeeId && auth.employeeId === employee.id)
    if (isSelf && auth.role !== 'SUPER_ADMIN') {
      const forbiddenSelfFields = [
        'baseSalary',
        'designation',
        'status',
        'role',
        'companyIds',
        'administeredCompanyIds',
      ]
      for (const field of forbiddenSelfFields) {
        if ((body as any)[field] !== undefined) {
          throw new ApiError(403, `Forbidden: ${auth.role} cannot self-modify sensitive field '${field}'`)
        }
      }
    }

    if (body.phone !== undefined && body.phone !== null && body.phone.trim()) {
      const phoneExists = await db.user.findFirst({
        where: { phone: body.phone.trim(), id: { not: employee.userId } },
      })
      if (phoneExists) throw new ApiError(409, 'Phone number already exists.')
    }

    // Role changes & Scope Synchronization check:
    const currentRole = employee.user.role
    const newRole = body.role
    let syncAdminScopes: string[] | null = null

    if (newRole !== undefined && newRole !== currentRole) {
      if (auth.role === 'SUPER_ADMIN') {
        // Allowed
      } else if (auth.role === 'COMPANY_ADMIN') {
        if (!['HR', 'MANAGER', 'EMPLOYEE'].includes(newRole)) {
          throw new ApiError(403, 'Forbidden: Company Admin may patch only HR, Manager, or Employee roles')
        }
        if (currentRole === 'SUPER_ADMIN' || currentRole === 'COMPANY_ADMIN') {
          throw new ApiError(403, 'Forbidden: Cannot modify Admin accounts')
        }
      } else {
        throw new ApiError(403, 'Forbidden: HR cannot modify user roles')
      }

      // Section 6.A (TS-03): Promotion to administrative role requires explicit administeredCompanyIds
      if (newRole === 'COMPANY_ADMIN' || newRole === 'HR') {
        if (!Array.isArray(body.administeredCompanyIds) || body.administeredCompanyIds.length === 0) {
          throw new ApiError(400, 'administeredCompanyIds array is required when promoting to administrative role')
        }
        syncAdminScopes = Array.from(new Set(body.administeredCompanyIds))
        for (const cid of syncAdminScopes) {
          assertCompanyInScope(cid, administeredIds)
        }
      }
    } else if (body.administeredCompanyIds !== undefined) {
      // Direct administrative scope modification without role change
      const effectiveRole = newRole ?? currentRole
      if (effectiveRole === 'COMPANY_ADMIN' || effectiveRole === 'HR') {
        syncAdminScopes = Array.from(new Set(body.administeredCompanyIds))
        for (const cid of syncAdminScopes) {
          assertCompanyInScope(cid, administeredIds)
        }
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

      // Transactional Scope Synchronization:
      // Promotion: assign new scopes
      // Demotion (TS-04): revoke all administrative scopes in same transaction
      if (newRole !== undefined && newRole !== currentRole) {
        if (newRole === 'COMPANY_ADMIN' || newRole === 'HR') {
          await tx.userCompanyScope.deleteMany({ where: { userId: employee.userId } })
          if (syncAdminScopes && syncAdminScopes.length > 0) {
            await tx.userCompanyScope.createMany({
              data: syncAdminScopes.map((cid: string) => ({ userId: employee.userId, companyId: cid })),
            })
          }
        } else if ((currentRole === 'COMPANY_ADMIN' || currentRole === 'HR') && (newRole === 'EMPLOYEE' || newRole === 'MANAGER')) {
          await tx.userCompanyScope.deleteMany({ where: { userId: employee.userId } })
        }
      } else if (syncAdminScopes !== null) {
        await tx.userCompanyScope.deleteMany({ where: { userId: employee.userId } })
        if (syncAdminScopes.length > 0) {
          await tx.userCompanyScope.createMany({
            data: syncAdminScopes.map((cid: string) => ({ userId: employee.userId, companyId: cid })),
          })
        }
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
          administeredCompanyIds: syncAdminScopes ?? undefined,
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
