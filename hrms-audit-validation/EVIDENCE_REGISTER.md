# Evidence Register: Code Paths, Line Numbers & Vulnerability Mapping

This register provides the definitive inventory of technical evidence supporting the second-stage audit findings.

---

## 1. Complete Findings Registry

| Finding ID | Severity | Category | File Path | Line Range | Verified Flaw Description | Expected Architecture | Runtime Test Required? |
|---|---|---|---|---|---|---|
| **F-01** | **P1** | Tenant Isolation | `src/app/(app)/leaves/approvals/page.tsx` | 22–37 | Omits tenant scoping for `COMPANY_ADMIN` and `HR`; renders all pending leaves across organizations. | Must filter by `scopedCompanyIds`. | No (Static AST confirmed) |
| **F-02** | **P1** | Validation | `src/app/api/leaves/route.ts` | 68–77 | Accepts unverified `leaveTypeId`; causes 500 error on non-existent UUIDs or crosses company boundaries. | Must pre-verify `leaveType.companyId === employee.companyId`. | No (Code verified) |
| **F-03** | **P2** | Security | `src/lib/rate-limit.ts` | 17–25, 77–86 | In-memory `Map` lacks cluster synchronization; unvalidated IP extraction; DoS via memory leak. | Distributed Redis store + trusted proxy IP extraction. | No (Architecture confirmed) |
| **F-04** | **P1** | Business Logic | `src/app/api/attendance/route.ts`<br>`src/app/api/attendance/sync/route.ts` | `route.ts:22`<br>`sync/route.ts:29` | 30-minute threshold conflict (10:00 AM vs 09:30 AM); UTC timezone drift; breaks overnight shifts. | Harmonized threshold, timezone awareness, multi-shift date modeling. | No (Code verified) |
| **F-05** | **P1** | Domain Architecture | `prisma/schema.prisma`<br>`src/app/api/leaves/route.ts` | `schema:151-180`<br>`route.ts:36-77` | No `LeaveBalance` model; system never evaluates `daysPerYear`; employees can apply for unlimited leave days. | Explicit balance ledger, quota deduction, and carry-forward engine. | No (Schema verified) |
| **F-06** | **P0** | Tenant Isolation | `src/app/(app)/employees/page.tsx`<br>`src/app/(app)/payroll/page.tsx`<br>`src/app/(app)/attendance/page.tsx`<br>`src/app/(app)/work-reports/page.tsx` | Multiple (see Section 2) | Systemic cross-tenant data leak across 4 primary SSR pages for `COMPANY_ADMIN` and `HR` roles. | Server Component queries must enforce `getScopedCompanyIds()`. | No (Code verified) |
| **F-07** | **P0** | Session Security | `src/lib/auth.ts`<br>`src/lib/api-auth.ts`<br>`src/proxy.ts` | `auth.ts:31`<br>`api-auth.ts:35-42` | Stateless 7-day JWT cannot be revoked; terminated/deactivated users retain administrative access. | Real-time database check on `User.isActive` in `requireAuth()`. | No (Architecture confirmed) |
| **F-08** | **P1** | Financial Integrity | `src/app/api/payroll/route.ts` | 94–118 | Payroll completely ignores attendance and unpaid leave; hardcoded mock percentages (12%, 5%). | True attendance proration, Loss of Pay deduction, statutory compliance. | No (Code verified) |
| **F-09** | **P2** | Security | `src/app/api/auth/change-password/route.ts` | 17–21 | Zero rate limiting on `currentPassword` verification allows authenticated brute-force cracking. | Wrap endpoint in rate limiter bucket. | No (Code verified) |
| **F-10** | **P2** | QA Architecture | `scripts/validate-workflow.mjs` | 3–6, 1252–1331 | Test suite runs directly on primary database, mutating and deleting real records. | Dedicated `unihr_test` database container. | No (Script inspected) |
| **F-11** | **P3** | Audit Integrity | `prisma/schema.prisma` | 468 | `AuditLog.user` specifies `onDelete: Cascade`, purging forensic history on user deletion. | Remove cascade; retain immutable audit history. | No (Schema verified) |

---

## 2. Granular Code Snippet Evidence

### Snippet 1: Employees Page Cross-Tenant Exposure (`F-06`)
```typescript
// File: src/app/(app)/employees/page.tsx
// Lines 19-37
const employees = await db.employee.findMany({
  where: q
    ? {
        OR: [
          { employeeCode: { contains: q, mode: 'insensitive' } },
          { designation: { contains: q, mode: 'insensitive' } },
          { user: { name: { contains: q, mode: 'insensitive' } } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
        ],
      }
    : {}, // <--- EMPTY FILTER EXPOSES ALL EMPLOYEES ACROSS COMPANIES
  orderBy: { employeeCode: 'asc' },
  include: {
    user: { select: { name: true, email: true, phone: true, role: true, isActive: true } },
    assignments: { include: { company: { select: { code: true } } }, orderBy: { isPrimary: 'desc' } },
    manager: { select: { employeeCode: true, user: { select: { name: true } } } },
    _count: { select: { directReports: true } },
  },
})
```

---

### Snippet 2: Payroll Page Cross-Tenant Exposure (`F-06`)
```typescript
// File: src/app/(app)/payroll/page.tsx
// Lines 28-35
const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'].includes(role)
...
const where = isAdmin ? {} : employeeId ? { employeeId } : { id: '__none__' }
// <--- COMPANY_ADMIN and HR RECEIVE {} AND QUERY ALL TENANT PAYROLL RECORDS!
```

---

### Snippet 3: Attendance Page Cross-Tenant Exposure (`F-06`)
```typescript
// File: src/app/(app)/attendance/page.tsx
// Lines 42-48
const where: Record<string, unknown> = {}
if (isAdmin) {
  if (role === 'MANAGER' && employeeId) where.employee = { managerId: employeeId }
  if (sp.companyId) where.companyId = sp.companyId // <--- NO VALIDATION THAT sp.companyId IS IN USER'S SCOPE
} else if (employeeId) {
  where.employeeId = employeeId
}
// <--- DEFAULT EMPTY where EXPOSES ALL TENANTS' PUNCHES
```

---

### Snippet 4: Work Reports Cross-Tenant Exposure (`F-06`)
```typescript
// File: src/app/(app)/work-reports/page.tsx
// Lines 27-33
const where: Record<string, unknown> = {}
if (scope === 'mine') {
  if (employeeId) where.employeeId = employeeId
} else {
  if (role === 'MANAGER' && employeeId) where.employee = { managerId: employeeId }
  if (sp.companyId) where.companyId = sp.companyId // <--- UNGUARDED QUERY PARAMETER
}
// <--- IN scope === 'team', COMPANY_ADMIN / HR VIEW ALL TENANTS' WORK REPORTS
```

---

### Snippet 5: NextAuth Stateless 7-Day JWT Token Lifecycle (`F-07`)
```typescript
// File: src/lib/auth.ts
// Lines 30-31
export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 }, // <--- 7-DAY IRREVOCABLE TOKEN
  ...
```

---

### Snippet 6: Test Suite Operational Database Connection (`F-10`)
```typescript
// File: scripts/validate-workflow.mjs
// Lines 3-6
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient(); // <--- BINDS DIRECTLY TO PRODUCTION/DEV DATABASE IN .env
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
```

