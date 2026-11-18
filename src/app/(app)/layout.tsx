import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { getLiveUser, getScopedCompanyIds } from '@/lib/api-auth'
import { isPayrollEnabled, isInstituteEnabled } from '@/lib/feature-gates'
import { assertPageAccess } from '@/lib/page-guard'
import { AppShell } from '@/components/app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')

  const live = await getLiveUser(session.user.id)
  if (!live || !live.isActive) redirect('/login')

  const headersList = await headers()
  const pathname = headersList.get('x-pathname') || ''
  if (pathname) {
    assertPageAccess(live.role, pathname)
  }

  const unread = await db.notification.count({ where: { userId: live.id, isRead: false } })

  // SUPER_ADMIN sees every company; others see their assigned/scoped ones
  let companies: { id: string; name: string; code: string; type: string }[] = []
  if (live.role === 'SUPER_ADMIN') {
    companies = await db.company.findMany({ select: { id: true, name: true, code: true, type: true }, orderBy: { createdAt: 'asc' } })
  } else {
    const scopedIds = await getScopedCompanyIds({
      role: live.role,
      userId: live.id,
      employeeId: live.employee?.id ?? null,
    })
    if (scopedIds && scopedIds.length > 0) {
      companies = await db.company.findMany({
        where: { id: { in: scopedIds } },
        select: { id: true, name: true, code: true, type: true },
        orderBy: { createdAt: 'asc' },
      })
    }
  }

  return (
    <AppShell
      user={{
        id: live.id,
        name: live.name ?? '',
        email: session.user.email ?? '',
        role: live.role,
        employeeCode: session.user.employeeCode,
      }}
      companies={companies}
      unreadCount={unread}
      enabledModules={{
        payroll: isPayrollEnabled(),
        institute: isInstituteEnabled() && (live.role === 'SUPER_ADMIN' || companies.some((c) => c.type === 'INSTITUTE')),
      }}
    >
      {children}
    </AppShell>
  )
}
