import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { getScopedCompanyIds } from '@/lib/api-auth'
import { HR_ROLES, AUDIT_ACTIONS, ROLES } from '@/lib/constants'
import { AuditView } from './audit-view'

export default async function AuditPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')

  if (!HR_ROLES.includes(session.user.role)) {
    redirect('/dashboard')
  }

  const scopedIds = await getScopedCompanyIds({
    role: session.user.role,
    userId: session.user.id,
    employeeId: session.user.employeeId,
  })

  const where: Record<string, unknown> = {}

  if (session.user.role === ROLES.COMPANY_ADMIN || session.user.role === ROLES.HR) {
    if (scopedIds && scopedIds.length) {
      where.OR = [
        { userId: session.user.id },
        { user: { employee: { assignments: { some: { companyId: { in: scopedIds } } } } } },
        { user: { companyScopes: { some: { companyId: { in: scopedIds } } } } },
      ]
    } else {
      where.userId = session.user.id
    }
  }

  const [total, initialLogs, users] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    }),
    db.user.findMany({
      where:
        session.user.role === ROLES.COMPANY_ADMIN && scopedIds && scopedIds.length
          ? {
              OR: [
                { id: session.user.id },
                { employee: { assignments: { some: { companyId: { in: scopedIds } } } } },
                { companyScopes: { some: { companyId: { in: scopedIds } } } },
              ],
            }
          : {},
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const serializedLogs = initialLogs.map((log) => ({
    ...log,
    createdAt: log.createdAt.toISOString(),
  }))

  const actions = Object.values(AUDIT_ACTIONS)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          System activity, compliance tracking, and administrative mutation records
        </p>
      </div>

      <AuditView initialLogs={serializedLogs} initialTotal={total} users={users} actions={actions} />
    </div>
  )
}

