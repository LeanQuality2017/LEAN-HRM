export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { requirePageAuth } from '@/lib/page-auth'
import { AUDIT_ACTIONS } from '@/lib/constants'
import { AuditView } from './audit-view'

export default async function AuditPage() {
  const auth = await requirePageAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'])
  const { role, userId, administeredCompanyIds } = auth
  const isSuperAdmin = role === 'SUPER_ADMIN'

  const where: Record<string, unknown> = {}

  if (!isSuperAdmin) {
    if (administeredCompanyIds && administeredCompanyIds.length > 0) {
      where.OR = [
        { userId },
        { user: { employee: { assignments: { some: { companyId: { in: administeredCompanyIds } } } } } },
        { user: { companyScopes: { some: { companyId: { in: administeredCompanyIds } } } } },
      ]
    } else {
      where.userId = userId
    }
  }

  const usersWhere: Record<string, unknown> = isSuperAdmin
    ? {}
    : administeredCompanyIds && administeredCompanyIds.length > 0
      ? {
          OR: [
            { id: userId },
            { employee: { assignments: { some: { companyId: { in: administeredCompanyIds } } } } },
            { companyScopes: { some: { companyId: { in: administeredCompanyIds } } } },
          ],
        }
      : { id: userId }

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
      where: usersWhere,
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
