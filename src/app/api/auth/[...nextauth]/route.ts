import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

const handler = NextAuth(authOptions)

export async function GET(req: Request, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const params = await ctx?.params
  if (params?.nextauth?.[0] === 'reset-rate-limit') {
    return new Response(null, { status: 404 })
  }
  return handler(req, ctx)
}

export async function POST(req: Request, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const params = await ctx?.params
  if (params?.nextauth?.[0] === 'reset-rate-limit') {
    return new Response(null, { status: 404 })
  }
  return handler(req, ctx)
}
