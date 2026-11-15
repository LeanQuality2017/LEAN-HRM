import { cache } from 'react'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { ROLES } from '@/lib/constants'
import { verifyPassword } from '@/lib/password'
import {
  buildRateLimitKey,
  isLoginRateLimited,
  recordFailedLogin,
  resetLoginRateLimit,
  getClientIp,
} from '@/lib/rate-limit'
import type { User } from '@prisma/client'

export interface AuthContext {
  userId: string
  role: string
  employeeId: string | null
  name: string
}

// Request-scoped user lookup for React Server Components (falls back to direct invocation in Route Handlers)
export const getLiveUser = cache(async (userId: string) => {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      isActive: true,
      employee: {
        select: {
          id: true,
        },
      },
    },
  })
})

// Returns live session info or null if unauthenticated, missing, or deactivated
export async function getAuth(): Promise<AuthContext | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null

  const liveUser = await getLiveUser(session.user.id)
  if (!liveUser || !liveUser.isActive) {
    return null
  }

  return {
    userId: liveUser.id,
    role: liveUser.role,
    employeeId: liveUser.employee?.id ?? null,
    name: liveUser.name ?? '',
  }
}

// Guard: returns auth or throws a Response
export async function requireAuth(roles?: string[]): Promise<AuthContext> {
  const auth = await getAuth()
  if (!auth) throw new ApiError(401, 'Unauthorized')
  if (roles && roles.length > 0 && !roles.includes(auth.role)) {
    throw new ApiError(403, 'Forbidden: insufficient permissions')
  }
  return auth
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Wrap route handlers with unified error handling
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    if (err && typeof err === 'object' && 'name' in err && err.name === 'ZodError') {
      const zErr = err as { issues?: Array<{ path?: Array<string | number>; message?: string }> }
      const issue = zErr.issues?.[0]
      const path = issue?.path?.length ? `${issue.path.join('.')}: ` : ''
      return Response.json({ error: `${path}${issue?.message || 'Invalid input'}` }, { status: 400 })
    }
    console.error('[API Error]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Get all company IDs the authenticated caller is strictly authorized to administer
// Derived EXCLUSIVELY from UserCompanyScope. Returns null for SUPER_ADMIN, [] for non-admin roles.
export async function getAdministeredCompanyIds(
  auth: AuthContext | { role: string; userId: string; employeeId?: string | null }
): Promise<string[] | null> {
  if (auth.role === 'SUPER_ADMIN') {
    return null // Global administrative scope
  }

  if (auth.role === 'COMPANY_ADMIN' || auth.role === 'HR') {
    const scopes = await db.userCompanyScope.findMany({
      where: { userId: auth.userId },
      select: { companyId: true },
    })
    return scopes.map((s) => s.companyId)
  }

  // Non-administrative roles (MANAGER, EMPLOYEE, STUDENT) fail closed to []
  return []
}

// Get all company IDs where the authenticated caller holds active employee assignments (for staff self-service)
// Derived EXCLUSIVELY from EmployeeCompanyAssignment.
export async function getEmployedCompanyIds(
  auth: AuthContext | { employeeId?: string | null }
): Promise<string[]> {
  if (!auth.employeeId) {
    return []
  }

  const assignments = await db.employeeCompanyAssignment.findMany({
    where: { employeeId: auth.employeeId },
    select: { companyId: true },
  })
  return assignments.map((a) => a.companyId)
}

// Get all scoped company IDs for an authenticated user (SUPER_ADMIN sees all -> returns null)
// Insecure employment fallback eliminated:
// - COMPANY_ADMIN / HR delegate strictly to getAdministeredCompanyIds (UserCompanyScope only)
// - MANAGER / EMPLOYEE delegate strictly to getEmployedCompanyIds (EmployeeCompanyAssignment only)
// - STUDENT returns institute companies
export async function getScopedCompanyIds(
  auth: AuthContext | { role: string; userId: string; employeeId?: string | null }
): Promise<string[] | null> {
  if (auth.role === 'SUPER_ADMIN') {
    return null // all companies unrestricted
  }

  if (auth.role === 'COMPANY_ADMIN' || auth.role === 'HR') {
    return getAdministeredCompanyIds(auth)
  }

  if (auth.role === 'MANAGER' || auth.role === 'EMPLOYEE') {
    return getEmployedCompanyIds(auth)
  }

  if (auth.role === 'STUDENT') {
    const inst = await db.company.findMany({
      where: { type: 'INSTITUTE' },
      select: { id: true },
    })
    return inst.map((c) => c.id)
  }

  return []
}

// Assert that a companyId falls within the caller's scopedCompanyIds (throws 403 ApiError if not)
export function assertCompanyInScope(companyId: string | null | undefined, scopedCompanyIds: string[] | null): void {
  if (scopedCompanyIds === null) return // SUPER_ADMIN has global scope
  if (!companyId || !scopedCompanyIds.includes(companyId)) {
    throw new ApiError(403, 'Forbidden: company out of scope')
  }
}

// Check if a companyId is in scope
export function isCompanyInScope(companyId: string, scopedCompanyIds: string[] | null): boolean {
  if (scopedCompanyIds === null) return true
  return scopedCompanyIds.includes(companyId)
}

// Assert that the caller has scope over institute operations
export async function assertInstituteInScope(scopedCompanyIds: string[] | null): Promise<void> {
  if (scopedCompanyIds === null) return // SUPER_ADMIN has global scope
  const institute = await db.company.findFirst({ where: { type: 'INSTITUTE' }, select: { id: true } })
  if (!institute || !scopedCompanyIds.includes(institute.id)) {
    throw new ApiError(403, 'Forbidden: institute operations out of scope')
  }
}

// Get all company IDs visible to a user (SUPER_ADMIN sees all -> returns null)
export async function visibleCompanyIds(auth: AuthContext): Promise<string[] | null> {
  return getScopedCompanyIds(auth)
}

// Reusable Superadmin Step-Up Credential Verification
export async function verifySuperadminStepUp(
  auth: AuthContext,
  email: string,
  password: string,
  req?: Request
): Promise<User> {
  if (auth.role !== ROLES.SUPER_ADMIN) {
    throw new ApiError(403, 'Forbidden: superadmin credential authorization required')
  }

  const cleanEmail = (email || '').toLowerCase().trim()
  const ip = getClientIp(req)
  const rateLimitKey = buildRateLimitKey(cleanEmail || 'unknown', ip)

  if (isLoginRateLimited(rateLimitKey)) {
    throw new ApiError(429, 'Too many attempts, try again later')
  }

  if (!cleanEmail || !password) {
    recordFailedLogin(rateLimitKey)
    throw new ApiError(401, 'Invalid credentials')
  }

  const user = await db.user.findUnique({
    where: { email: cleanEmail },
  })

  if (!user || !user.isActive || user.role !== ROLES.SUPER_ADMIN || user.id !== auth.userId) {
    recordFailedLogin(rateLimitKey)
    throw new ApiError(401, 'Invalid credentials')
  }

  const valid = verifyPassword(password, user.passwordHash)
  if (!valid) {
    recordFailedLogin(rateLimitKey)
    throw new ApiError(401, 'Invalid credentials')
  }

  resetLoginRateLimit(rateLimitKey)
  return user
}
