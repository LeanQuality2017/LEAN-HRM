import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { checkPageAccess } from '@/lib/page-guard'

const isDev = process.env.NODE_ENV !== 'production'

// Next.js 16 proxy / middleware with per-request Nonce & CSP
export async function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const cspHeader = isDev
    ? `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`
    : `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const hasSession = !!token
  const { pathname } = req.nextUrl

  if (pathname === '/login' && hasSession) {
    const target = token?.role === 'SUPER_ADMIN' ? '/companies' : '/dashboard'
    return NextResponse.redirect(new URL(target, req.url))
  }

  if (pathname === '/' && hasSession) {
    const target = token?.role === 'SUPER_ADMIN' ? '/companies' : '/dashboard'
    return NextResponse.redirect(new URL(target, req.url))
  }

  if (!hasSession && !pathname.startsWith('/api') && pathname !== '/login' && pathname !== '/offline') {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Role-based page gating
  if (hasSession && !pathname.startsWith('/api')) {
    const role = (token?.role as string) || ''
    const redirectTarget = checkPageAccess(role, pathname)
    if (redirectTarget && redirectTarget !== pathname) {
      return NextResponse.redirect(new URL(redirectTarget, req.url))
    }
  }

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', pathname)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', cspHeader)

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
  response.headers.set('Content-Security-Policy', cspHeader)
  return response
}

export const middleware = proxy

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|.*\\.png$).*)'],
}
