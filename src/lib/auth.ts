import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { ROLE_LABELS } from '@/lib/constants'
import {
  buildRateLimitKey,
  isLoginRateLimited,
  recordFailedLogin,
  resetLoginRateLimit,
  getClientIp,
} from '@/lib/rate-limit'

const LEGACY_PERSON_NAMES = [
  'Vikram Chandra',
  'Priya Raghavan',
  'Sneha Iyer',
  'Arun Kumar',
  'Karthik Raj',
  'Meena Shetty',
  'Rahul Verma',
  'Divya Nair',
  'Sanjay Gupta',
  'Ravi Teja',
  'Anita Desai',
  'Deepak Menon',
  'Farhana Khan',
]

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  // NextAuth v4: useSecureCookies automatically engages when NEXTAUTH_URL starts with "https://".
  // TLS terminates at reverse proxy (nginx/Caddy) in production, while local HTTP testing preserves non-secure cookies.
  useSecureCookies: Boolean(process.env.NEXTAUTH_URL?.startsWith('https://')),
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: { email: { label: 'Email' }, password: { label: 'Password' } },
      async authorize(credentials, req) {
        if (process.env.NODE_ENV === 'production' && !process.env.NEXTAUTH_URL?.startsWith('https://')) {
          throw new Error('FATAL: NEXTAUTH_URL must be a canonical HTTPS URL in production.')
        }

        if (!credentials?.email || !credentials?.password) return null

        const ip = getClientIp(req)
        const rateLimitKey = buildRateLimitKey(credentials.email, ip)

        if (isLoginRateLimited(rateLimitKey)) {
          throw new Error('Too many attempts, try again later')
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
          include: { employee: true },
        })
        if (!user || !user.isActive) {
          recordFailedLogin(rateLimitKey)
          return null
        }
        const ok = verifyPassword(credentials.password, user.passwordHash)
        if (!ok) {
          recordFailedLogin(rateLimitKey)
          return null
        }

        resetLoginRateLimit(rateLimitKey)

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          employeeId: user.employee?.id ?? null,
          employeeCode: user.employee?.employeeCode ?? null,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.role = (user as { role: string }).role
        token.employeeId = (user as { employeeId: string | null }).employeeId
        token.employeeCode = (user as { employeeCode: string | null }).employeeCode
      }
      if (token.name && LEGACY_PERSON_NAMES.includes(token.name as string)) {
        token.name = ROLE_LABELS[token.role as string] ?? 'User'
      }
      if (trigger === 'update') {
        const dbUser = await db.user.findUnique({ where: { id: token.sub ?? '' }, include: { employee: true } })
        if (dbUser) {
          token.name = dbUser.name
          token.role = dbUser.role
          token.employeeId = dbUser.employee?.id ?? null
          token.employeeCode = dbUser.employee?.employeeCode ?? null
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string
        session.user.role = token.role as string
        session.user.employeeId = (token.employeeId as string | null) ?? null
        session.user.employeeCode = (token.employeeCode as string | null) ?? null
        if (!token.name || LEGACY_PERSON_NAMES.includes(token.name as string)) {
          session.user.name = ROLE_LABELS[token.role as string] ?? 'User'
        }
      }
      return session
    },
  },
}
