import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

type DbOrTx = Prisma.TransactionClient | typeof db

export async function logAudit(
  client: DbOrTx,
  userId: string,
  action: string,
  entity: string,
  entityId?: string | null,
  meta?: unknown
) {
  let metaStr: string | null = null

  if (meta != null) {
    if (typeof meta === 'string') {
      metaStr = meta
    } else {
      try {
        metaStr = JSON.stringify(meta)
      } catch {
        metaStr = String(meta)
      }
    }
  }

  return client.auditLog.create({
    data: {
      userId,
      action,
      entity,
      entityId: entityId ?? null,
      meta: metaStr,
    },
  })
}

