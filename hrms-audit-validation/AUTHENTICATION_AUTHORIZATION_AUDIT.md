# Authentication, Session Lifecycle & Authorization Audit

**Vulnerability Classification:** P0 / P1 (Critical & High Security Defect)  
**Target:** NextAuth v4 Configuration, Password Storage, Session Management, and Role-Based Access Control (RBAC)  
**Key Affected Areas:** `src/lib/auth.ts`, `src/lib/password.ts`, `src/lib/api-auth.ts`, `src/proxy.ts`  

---

## 1. Password Storage & Hashing Verification

UniHR avoids external hashing libraries (e.g. bcrypt, argon2) in favor of Node.js native `node:crypto`:

```typescript
// src/lib/password.ts:7-17
const KEY_LEN = 64
const SALT_LEN = 16

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex')
  const derived = crypto.scryptSync(plain, salt, KEY_LEN).toString('hex')
  return `${salt}:${derived}`
}

export function verifyPassword(plain: string, combined: string): boolean {
  const [salt, hash] = combined.split(':')
  if (!salt || !hash) return false
  const derived = crypto.scryptSync(plain, salt, KEY_LEN).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'))
}
```

### Assessment
- **Salt Generation:** Cryptographically secure 16-byte random salt generated via `crypto.randomBytes`.
- **Algorithm:** `scryptSync` (CPU/memory-hard key derivation function).
- **Comparison:** Uses `crypto.timingSafeEqual` to prevent timing attacks.
- **Finding:** Password hashing implementation is **ROBUST AND SECURE**.

---

## 2. Session Architecture & Broken Invalidation (P0 Defect)

NextAuth is configured using stateless signed JSON Web Tokens (JWT):

```typescript
// src/lib/auth.ts:30-31
export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  ...
```

### Critical Flaw: 7-Day Stale JWT Privilege Persistence

1. **Stateless JWT Verification:**
   - Once issued at login, the JWT cookie (`next-auth.session-token`) remains valid for 7 days (`604,800 seconds`).
   - The token contains: `id`, `email`, `role`, `employeeId`, and `name`.
2. **Proxy Middleware Logic (`src/proxy.ts:16-41`):**
   - The proxy retrieves `token = await getToken({ req, secret })`.
   - It performs role checking using `token.role` extracted directly from the decrypted JWT.
   - **It never queries the database to verify if the user account is still active.**
3. **API Route Guard Logic (`src/lib/api-auth.ts:23-42`):**
   - `requireAuth()` calls `getAuth()`, which executes `getServerSession(authOptions)`.
   - `getServerSession()` reads session claims from the verified JWT token without contacting PostgreSQL.

### Real-World Attack Scenarios

- **Scenario A: Immediate Post-Termination Access (Data Exfiltration / Sabotage):**
  - An HR administrator deactivates a terminated employee in the database (`User.isActive = false`).
  - The employee's browser still possesses the signed 7-day JWT.
  - The employee can continue to make authenticated requests, download employee lists, view payroll data, submit requests, and access the application until the 7-day window expires.
- **Scenario B: Role Demotion Failure:**
  - A compromised or rogue `COMPANY_ADMIN` account has its role downgraded to `EMPLOYEE` in the database.
  - The user's active session token still asserts `role: 'COMPANY_ADMIN'`.
  - The user retains complete administrative control over company settings, user creation, and employee records for up to 7 days.
- **Scenario C: Inability to Revoke Sessions on Password Reset:**
  - When an admin executes a password reset (`/api/users/reset-password`), the password hash is updated in the database.
  - However, existing issued JWTs for that account are not invalidated and remain usable until expiration.

### Required Remediation
Implement a `tokenVersion` or `sessionVersion` column on the `User` model, or introduce a lightweight database check inside `requireAuth()`:

```typescript
// src/lib/api-auth.ts (Hardened Guard)
export async function requireAuth(roles?: string[]): Promise<AuthContext> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) throw new ApiError(401, 'Unauthorized')

  // Real-time account validity check:
  const liveUser = await db.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, role: true },
  })
  if (!liveUser || !liveUser.isActive) {
    throw new ApiError(401, 'Account deactivated or session revoked')
  }

  if (roles && roles.length > 0 && !roles.includes(liveUser.role)) {
    throw new ApiError(403, 'Forbidden: insufficient permissions')
  }

  return { ...session.user, role: liveUser.role }
}
```

---

## 3. Role-Based Access Control (RBAC) Matrix

UniHR defines six distinct roles in `src/lib/constants.ts`:
- `SUPER_ADMIN`: Global system owner across all 3 companies.
- `COMPANY_ADMIN`: Organization owner restricted to assigned tenant.
- `HR`: Human Resources officer restricted to assigned tenant.
- `MANAGER`: Team lead supervising direct reports within assigned tenant.
- `EMPLOYEE`: Individual staff member.
- `STUDENT`: Institute student enrolled at SkillEdge Academy.

### Server-Enforced RBAC Permissions Matrix

| Module / Operation | SUPER_ADMIN | COMPANY_ADMIN | HR | MANAGER | EMPLOYEE | STUDENT | Verification File & Guard |
|---|---|---|---|---|---|---|---|
| **View Companies** | Read All | Read Scoped | Read Scoped | Denied | Denied | Denied | `page-guard.ts:18`, `companies/route.ts` |
| **Create Company** | Allowed | Denied | Denied | Denied | Denied | Denied | `api/companies/route.ts:51` |
| **Hard-Delete Company** | Allowed (Step-up) | Denied | Denied | Denied | Denied | Denied | `api/companies/[id]/delete/route.ts:15` |
| **View Employee List** | All | Scoped (Leak*) | Scoped (Leak*) | Scoped (Leak*) | Denied | Denied | `page-guard.ts:46`, `employees/page.tsx` |
| **Create/Edit Employee** | Allowed | Scoped | Scoped | Denied | Denied | Denied | `api/employees/route.ts:31, 88` |
| **Web Attendance Punch** | Allowed | Allowed | Allowed | Allowed | Allowed | Denied | `api/attendance/route.ts:10` |
| **Manual Attendance Fix** | Allowed | Scoped | Scoped | Denied | Denied | Denied | `api/attendance/route.ts:106` |
| **Apply Leave** | Allowed | Allowed | Allowed | Allowed | Allowed | Denied | `api/leaves/route.ts:10` |
| **Approve/Reject Leave** | Allowed | Scoped (Leak*) | Scoped (Leak*) | Direct Reports | Denied | Denied | `api/leaves/[id]/route.ts:10, 41` |
| **Generate Payroll** | Allowed | Scoped | Scoped | Denied | Denied | Denied | `api/payroll/route.ts:72` |
| **View Own Payslip** | Allowed | Allowed | Allowed | Allowed | Allowed | Denied | `api/payroll/route.ts:24` |
| **Submit EOD Work Report** | Allowed | Allowed | Allowed | Allowed | Allowed | Denied | `api/work-reports/route.ts:10` |
| **Review Work Report** | Allowed | Scoped (Leak*) | Scoped (Leak*) | Direct Reports | Denied | Denied | `api/work-reports/[id]/route.ts:10` |
| **View Institute Data** | Allowed | Scoped | Scoped | Denied | Denied | Own Data | `page-guard.ts:60`, `assertInstituteInScope` |
| **Export Data (CSV)** | Allowed | Scoped | Scoped | Denied | Denied | Denied | `api/export/[type]/route.ts:13` |
| **View Audit Logs** | Allowed | Scoped | Scoped | Denied | Denied | Denied | `api/audit/route.ts:9` |

*\*Note: (Leak) denotes where the API route enforces 403, but the corresponding Server Component SSR page leaks cross-tenant records.*

---

## 4. Edge Proxy Security & CSP Verification

Inspecting `src/proxy.ts`:
- **Strict Content Security Policy (CSP):**
  - Production generates a unique UUID nonce per request: `crypto.randomUUID()`.
  - Sets `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`.
  - Sets `frame-ancestors 'none'` to mitigate Clickjacking attacks.
  - Sets `base-uri 'self'`, `form-action 'self'`, and `object-src 'none'`.
- **Assessment:** CSP proxy configuration follows modern OWASP hardening standards.

