import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLiveUser, getAdministeredCompanyIds, getEmployedCompanyIds } from '@/lib/api-auth'

export interface PageAuthContext {
  userId: string
  employeeId: string | null
  role: string
  name: string
  administeredCompanyIds: string[] | null
  employedCompanyIds: string[]
}

export async function requirePageAuth(allowedRoles?: string[]): Promise<PageAuthContext> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect('/login')
  }

  const live = await getLiveUser(session.user.id)
  if (!live || !live.isActive) {
    redirect('/login')
  }

  const role = live.role
  if (allowedRoles && !allowedRoles.includes(role)) {
    redirect('/dashboard')
  }

  const authCtx = {
    userId: live.id,
    role,
    employeeId: live.employee?.id ?? null,
    name: live.name ?? '',
  }

  const administeredCompanyIds = await getAdministeredCompanyIds(authCtx)
  const employedCompanyIds = await getEmployedCompanyIds(authCtx)

  return {
    ...authCtx,
    administeredCompanyIds,
    employedCompanyIds,
  }
}
