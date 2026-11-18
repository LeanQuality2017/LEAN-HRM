# API Route Handlers & Server Mutations Security Audit

**Vulnerability Classification:** P1 / P2 (Input Validation, IDOR & Error Handling Gaps)  
**Target:** 27 REST Route Handlers under `src/app/api/`  
**Key Framework Architecture:** Next.js 16 App Router Route Handlers  

---

## 1. Architectural Strategy: Route Handlers vs Server Actions

UniHR implements backend mutations almost exclusively via **Next.js App Router Route Handlers** (`src/app/api/**/route.ts`), rather than experimental Server Actions.

### Evaluation of the Core Handler Wrapper (`src/lib/api-auth.ts:53-69`)
```typescript
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    if (err && typeof err === 'object' && 'name' in err && err.name === 'ZodError') {
      const zErr = err as { issues?: Array<{ path?: Array<string | number>; message?: string }> }
      const issue = zErr.issues?.[0]
      const path = issue?.path?.length ? `${issue.path.join('.')}: ` : ''
      return Response.json({ error: `${path}${issue?.message || 'Invalid input'}` }, { status: 400 })
    }
    console.error('[API Error]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

### Assessment
- **Consistent Response Schema:** Errors return structured JSON `{ error: string }`.
- **Validation Failure Trapping:** Zod errors are intercepted and translated into HTTP 400 with path context.
- **Internal Exception Shielding:** Uncaught exceptions mask internal stack traces and return a generic 500 message.

---

## 2. Insecure Direct Object Reference (IDOR) & Tenant Parameter Checks

We inspected all mutation endpoints for IDOR vulnerabilities where an attacker could supply an unauthorized resource ID.

| Route Handler | Method | Parameter Type | Authorization & Scope Guard Check | IDOR Risk Level |
|---|---|---|---|---|
| `/api/companies/[id]/delete` | `POST` | Dynamic URL Segment `[id]` | Verifies `SUPER_ADMIN`, re-authenticates password, checks `PROTECTED_CODES`. | **None (Protected)** |
| `/api/leaves/[id]` | `PATCH` | Dynamic URL Segment `[id]` | Resolves `leave.employee.assignments` and asserts against `scopedCompanyIds`. Manager restricted to direct reports. | **None (Protected)** |
| `/api/work-reports/[id]` | `POST` | Dynamic URL Segment `[id]` | Resolves report's company and asserts against caller scope. | **None (Protected)** |
| `/api/payroll?id=` | `PATCH` | Query Parameter `id` | Resolves `payroll.employee.assignments` and asserts against caller scope. | **None (Protected)** |
| `/api/attendance?id=` | `PATCH` | Query Parameter `id` | Checks `assertCompanyInScope(existing.companyId, scopedIds)`. | **None (Protected)** |
| `/api/leaves` | `POST` | JSON Body `leaveTypeId` | **Omitted check**: Does not verify that `leaveTypeId` belongs to applicant's company. | **HIGH (Vulnerable)** |
| `/api/fees` | `POST` | JSON Body `studentId` | Enforces institute scope check before creation. | **Low** |
| `/api/enroll` | `POST` | JSON Body `studentId`, `batchId` | Enforces institute scope check. | **Low** |

### IDOR Assessment Summary
Direct record lookups by ID in API route handlers generally enforce tenant scope assertions. The primary failure point is **cross-reference validation**, where secondary entities (such as `leaveTypeId`) are accepted without verifying tenant ownership.

---

## 3. Zod Schema Validation Coverage

All incoming request bodies in route handlers are validated using Zod schemas declared in `src/lib/validation.ts`:
- Primitive safety: Text fields enforce length caps (max 120, 2,000, or 5,000 chars) to prevent payload buffer exhaustion.
- Enums: Status fields (`attendanceStatusEnum`, `leaveStatusEnum`, `roleEnum`) reject unknown string literals.
- Numbers: Salary and amounts are coerced and checked (`min: 0`, positive, max limits).

### Unhandled Edge Cases in Validation
1. **Date Inversions:** `leaveCreateSchema` validates that `startDate` and `endDate` are valid ISO strings, but the schema level does not enforce `endDate >= startDate`. This check is handled imperatively in the route handler (`src/app/api/leaves/route.ts:35`).
2. **Biometric Batch Cap:** While `biometricSyncSchema` checks array items, the 500-item batch cap is checked imperatively before schema parsing (`src/app/api/attendance/sync/route.ts:51`).

---

## 4. Unprotected Endpoints & Mutation Gaps

1. **Silent Attendance Patching:**
   `PATCH /api/attendance` allows HR to alter check-in/out timestamps and attendance statuses (`PRESENT`, `ABSENT`, `LEAVE`) without creating an `AuditLog` entry.
2. **Missing Rate Limiting on Credential Verifications:**
   `POST /api/auth/change-password` tests the user's existing password via `verifyPassword(body.currentPassword, user.passwordHash)`. There is no rate limiter on this endpoint, enabling an adversary with a stolen or hijacked session token to brute-force the plaintext password.
3. **Database P2003 Constraint Leaks:**
   In routes where foreign keys are not pre-checked (e.g. `POST /api/leaves` with invalid `leaveTypeId`), Prisma raises constraint violations that result in HTTP 500 errors rather than clean 400 Bad Request responses.

