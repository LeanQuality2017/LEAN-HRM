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
  let metaPayload: Record<string, unknown> = {}

  if (meta != null) {
    if (typeof meta === 'string') {
      try {
        const parsed = JSON.parse(meta)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          metaPayload = parsed
        } else {
          metaPayload = { data: meta }
        }
      } catch {
        metaPayload = { message: meta }
      }
    } else if (typeof meta === 'object' && !Array.isArray(meta)) {
      metaPayload = { ...(meta as Record<string, unknown>) }
    } else {
      metaPayload = { data: meta }
    }
  }

  // Preserve actor userId snapshot inside meta so the audit record remains readable even if user is deleted
  if (userId && !metaPayload.actorId) {
    metaPayload.actorId = userId
  }

  let metaStr: string | null = null
  try {
    metaStr = JSON.stringify(metaPayload)
  } catch {
    metaStr = String(meta)
  }

  return client.auditLog.create({
    data: {
      userId: userId || null,
      action,
      entity,
      entityId: entityId ?? null,
      meta: metaStr,
    },
  })
}

