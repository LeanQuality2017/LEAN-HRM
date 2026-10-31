import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { getScopedCompanyIds } from '@/lib/api-auth'
import { assertPageAccess } from '@/lib/page-guard'
import { AppShell } from '@/components/app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const headersList = await headers()
  const pathname = headersList.get('x-pathname') || ''
  if (pathname) {
    assertPageAccess(session.user.role, pathname)
  }

  const unread = await db.notification.count({ where: { userId: session.user.id, isRead: false } })

  // SUPER_ADMIN sees every company; others see their assigned/scoped ones
  let companies: { id: string; name: string; code: string; type: string }[] = []
  if (session.user.role === 'SUPER_ADMIN') {
    companies = await db.company.findMany({ select: { id: true, name: true, code: true, type: true }, orderBy: { createdAt: 'asc' } })
  } else {
    const scopedIds = await getScopedCompanyIds({ role: session.user.role, userId: session.user.id, employeeId: session.user.employeeId })
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
      user={{ id: session.user.id, name: session.user.name ?? '', email: session.user.email ?? '', role: session.user.role, employeeCode: session.user.employeeCode }}
      companies={companies}
      unreadCount={unread}
    >
      {children}
    </AppShell>
  )
}
