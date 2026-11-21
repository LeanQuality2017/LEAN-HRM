import { describe, it, expect } from 'vitest'
import { handle, ApiError } from '@/lib/api-auth'
import { Prisma } from '@prisma/client'

describe('WO-CLEANUP-1 C1: handle() Prisma Error Mapping', () => {
  it('maps Prisma P2002 unique constraint error to HTTP 409 Conflict with generic message', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`name`)', {
      code: 'P2002',
      clientVersion: '6.11.1',
    })

    const res = await handle(async () => {
      throw error
    })

    expect(res.status).toBe(409)
    const json = (await res.json()) as { error: string }
    expect(json).toEqual({ error: 'Conflict: resource already exists' })
  })

  it('maps Prisma P2025 record not found error to HTTP 404 Not Found with generic message', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('An operation failed because it depends on one or more records that were required but not found', {
      code: 'P2025',
      clientVersion: '6.11.1',
    })

    const res = await handle(async () => {
      throw error
    })

    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: string }
    expect(json).toEqual({ error: 'Record not found' })
  })

  it('maps Prisma P2003 foreign key constraint error to HTTP 400 Bad Request with generic message', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed on the field: `companyId`', {
      code: 'P2003',
      clientVersion: '6.11.1',
    })

    const res = await handle(async () => {
      throw error
    })

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json).toEqual({ error: 'Invalid reference: related record does not exist' })
  })

  it('preserves existing ApiError status and message', async () => {
    const res = await handle(async () => {
      throw new ApiError(403, 'Forbidden: company out of scope')
    })

    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string }
    expect(json).toEqual({ error: 'Forbidden: company out of scope' })
  })

  it('maps unhandled runtime errors to HTTP 500 with sanitized message', async () => {
    const res = await handle(async () => {
      throw new Error('Database connection crashed unexpectedly')
    })

    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string }
    expect(json).toEqual({ error: 'Internal server error' })
  })
})

