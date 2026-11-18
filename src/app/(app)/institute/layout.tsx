import { redirect } from 'next/navigation'
import { getAuth, getAdministeredCompanyIds, assertInstituteInScope } from '@/lib/api-auth'
import { isInstituteEnabled } from '@/lib/feature-gates'

export default async function InstituteLayout({ children }: { children: React.ReactNode }) {
  if (!isInstituteEnabled()) {
    redirect('/dashboard')
  }

  const auth = await getAuth()
  if (!auth) redirect('/login')

  if (auth.role !== 'SUPER_ADMIN') {
    const administeredIds = await getAdministeredCompanyIds(auth)
    try {
      await assertInstituteInScope(administeredIds)
    } catch {
      redirect('/dashboard')
    }
  }

  return <>{children}</>
}

