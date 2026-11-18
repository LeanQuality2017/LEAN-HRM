# Verification of Original Audit Findings (F-01 through F-05)

This report provides the line-by-line evidence and architectural analysis validating findings F-01 through F-05 from the preliminary audit.

---

## 1. Finding F-01: Cross-Company Leave Approval Data Leakage

- **Original Severity:** P1 (High)
- **Validation Status:** **CONFIRMED**
- **Confidence:** Absolute (100%)
- **Affected Module:** Leave Management UI (`/leaves/approvals`)
- **Exact File:** `src/app/(app)/leaves/approvals/page.tsx`
- **Line Numbers:** Lines 13–37

### Detailed Technical Breakdown

In Next.js App Router, React Server Components execute directly on the Node.js server. `LeaveApprovalsPage` obtains the session user:

```typescript
// src/app/(app)/leaves/approvals/page.tsx:13-16
const session = await getServerSession(authOptions)
if (!session?.user?.id) redirect('/login')
const role = session.user.role
const employeeId = session.user.employeeId
```

The database query where-clause is then constructed as follows:

```typescript
// src/app/(app)/leaves/approvals/page.tsx:22-24
const where: Record<string, unknown> = { status: 'PENDING' }
if (role === 'MANAGER' && employeeId) where.employee = { managerId: employeeId }

const [total, requests] = await Promise.all([
  db.leaveRequest.count({ where }),
  db.leaveRequest.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    skip,
    take: pageSize,
    include: {
      employee: { select: { employeeCode: true, user: { select: { name: true } } } },
      leaveType: { select: { name: true } },
    },
  }),
])
```

### Analysis of the Defect

1. **User Role Branching:**
   - When `role === 'MANAGER'`, `where.employee = { managerId: employeeId }` scopes the query to direct reports.
   - When `role === 'COMPANY_ADMIN'` or `role === 'HR'`, the condition is false. The `where` object remains `{ status: 'PENDING' }`.
2. **Tenant Exposure:**
   - The query performs a global database scan across all tenants.
   - An HR manager from Alpha Technologies (`hr1@unihr.com`) or a Company Admin from Alpha (`admin1@unihr.com`) visiting `/leaves/approvals` is presented with pending leave applications submitted by employees of Beta Solutions (`BETA`) and SkillEdge Academy (`SKILL`).
   - The rendered table exposes: employee full names, employee codes, leave types, start and end dates, reason notes, and application dates across organizations.
3. **API vs UI Discrepancy:**
   - When the user clicks the "Approve" button, the client component triggers `PATCH /api/leaves/[id]`.
   - `src/app/api/leaves/[id]/route.ts:32-38` checks `getScopedCompanyIds(auth)` and rejects cross-company approvals with HTTP 403 Forbidden.
   - While the API prevents unauthorized state mutations, **the SSR page constitutes an active multi-tenant information disclosure vulnerability**.

### Remediation Blueprint
Update `src/app/(app)/leaves/approvals/page.tsx` to retrieve and apply `scopedCompanyIds`:

```typescript
const scopedIds = await getScopedCompanyIds({ role, userId: session.user.id, employeeId })
const where: Record<string, unknown> = { status: 'PENDING' }
if (role === 'MANAGER' && employeeId) {
  where.employee = { managerId: employeeId }
} else if (scopedIds && scopedIds.length) {
  where.employee = { assignments: { some: { companyId: { in: scopedIds } } } }
}
```

---

## 2. Finding F-02: Leave Type Company Validation Missing

- **Original Severity:** P1 (High)
- **Validation Status:** **CONFIRMED**
- **Confidence:** Absolute (100%)
- **Affected Module:** Leave Application API (`POST /api/leaves`)
- **Exact File:** `src/app/api/leaves/route.ts`
- **Line Numbers:** Lines 8–79

### Detailed Technical Breakdown

When submitting a leave request via `POST /api/leaves`:

```typescript
// src/app/api/leaves/route.ts:8-13
const auth = await requireAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'])
const body = validateBody(leaveCreateSchema, await req.json())
```

The payload is validated against `leaveCreateSchema` (`src/lib/validation.ts:167-174`):

```typescript
export const leaveCreateSchema = z.object({
  employeeId: shortString.optional(),
  leaveTypeId: shortString,
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  reason: textField,
})
```

The leave insertion proceeds directly to database creation:

```typescript
// src/app/api/leaves/route.ts:68-77
const leave = await db.leaveRequest.create({
  data: {
    employeeId: targetEmployeeId,
    leaveTypeId: body.leaveTypeId,
    startDate: start,
    endDate: end,
    days,
    reason: body.reason,
  },
})
```

### Analysis of the Defect

1. **Missing Entity & Scope Verification:**
   - The handler performs zero verification that `body.leaveTypeId` exists in the database.
   - The handler performs zero verification that `body.leaveTypeId` belongs to the applicant's assigned company.
2. **Failure Modes:**
   - **Invalid Foreign Key:** If an applicant submits a random string or non-existent UUID for `leaveTypeId`, Prisma throws `PrismaClientKnownRequestError: P2003 Foreign key constraint failed`. The unified `handle()` wrapper catches this and returns HTTP 500 "Internal server error" instead of a clean HTTP 400 Bad Request.
   - **Cross-Tenant Leave Type Injection:** If an employee of Alpha Technologies specifies a valid `leaveTypeId` belonging to Beta Solutions, Prisma writes the record successfully. The leave request is permanently bound to another company's leave category, skewing leave reporting and audit trails.
3. **Multi-Company Shared Employees:**
   - For employees assigned to multiple companies (e.g. `employee4@unihr.com`), `LeaveRequest` lacks a `companyId` foreign key. The company context is implicitly derived from `LeaveType.companyId`, allowing employees to mistakenly or maliciously charge leave to the wrong corporate entity.

### Remediation Blueprint
Validate `leaveTypeId` against the applicant's company before record creation:

```typescript
const primary = await db.employeeCompanyAssignment.findFirst({
  where: { employeeId: targetEmployeeId, isPrimary: true },
})
if (!primary) throw new ApiError(400, 'Employee has no active company assignment')

const leaveType = await db.leaveType.findFirst({
  where: { id: body.leaveTypeId, companyId: primary.companyId },
})
if (!leaveType) {
  throw new ApiError(400, 'Invalid leave type for employee company')
}
```

---

## 3. Finding F-03: In-Memory Rate Limiter Vulnerabilities

- **Original Severity:** P2 (Medium)
- **Validation Status:** **CONFIRMED & EXPANDED**
- **Confidence:** High (95%)
- **Affected Module:** Core Rate Limiting & Auth (`src/lib/rate-limit.ts`)
- **Exact File:** `src/lib/rate-limit.ts`
- **Line Numbers:** Lines 1–91

### Detailed Technical Breakdown

```typescript
// src/lib/rate-limit.ts:17-25
export const loginRateLimitMap =
  globalForRateLimit.loginRateLimitMap || new Map<string, RateLimitRecord>()

if (process.env.NODE_ENV !== 'production') {
  globalForRateLimit.loginRateLimitMap = loginRateLimitMap
}
```

### Analysis of the Defect

1. **Clustered / Multi-Pod Deployments:**
   - Storage is a local JavaScript `Map`. In any horizontally scaled environment (e.g., Kubernetes pods, multi-container Docker Swarm, AWS ECS tasks, or serverless workers), each node maintains an isolated memory space.
   - A distributed brute-force attack alternating requests across $N$ instances effectively multiplies allowed attempts to $5 \times N$.
2. **Memory Exhaustion (DoS) Risk:**
   - Expired records are deleted only when re-queried (`if (now > record.resetTime) loginRateLimitMap.delete(key)`).
   - An adversary generating high-frequency login attempts using randomized fake email addresses will continuously populate `loginRateLimitMap` with uncollected records, resulting in process memory exhaustion.
3. **Header Spoofing & IP Extraction:**
   - Lines 77–86 extract IP from `x-forwarded-for` and `x-real-ip` without verifying proxy trust. An attacker connecting directly can supply arbitrary `x-forwarded-for: <random-ip>` headers to reset their rate-limiting bucket on every attempt.
4. **Expanded Scope: Unprotected Endpoints:**
   - Administrative password reset (`POST /api/users/reset-password`) has **no rate limiting**.
   - Authenticated password change (`POST /api/auth/change-password`) invokes `verifyPassword(body.currentPassword, user.passwordHash)` on line 17 with **zero rate limiting**, permitting brute-force enumeration of existing passwords from compromised sessions.

### Remediation Blueprint
Replace the in-memory map with an atomic distributed cache (Redis token bucket) or database-backed rate limit table, and wrap password mutation endpoints with rate checks.

---

## 4. Finding F-04: Attendance Timezone and Threshold Inconsistency

- **Original Severity:** P2 (Medium)
- **Validation Status:** **CONFIRMED & UPGRADED TO P1 (HIGH)**
- **Confidence:** Absolute (100%)
- **Affected Module:** Attendance Punch & Device Synchronization
- **Exact Files:** `src/app/api/attendance/route.ts`, `src/app/api/attendance/sync/route.ts`
- **Line Numbers:** `route.ts:13-22`, `sync/route.ts:24-33`

### Detailed Technical Breakdown

#### Policy Threshold Inconsistency
- **Web Check-In (`route.ts:22`):**
  ```typescript
  const status = now.getHours() >= 10 ? ATTENDANCE_STATUS.LATE : ATTENDANCE_STATUS.PRESENT
  ```
  Punching at 09:45 AM via the web application results in `status: PRESENT` (Late only after 10:00:00 AM).
- **Biometric Push (`sync/route.ts:29`):**
  ```typescript
  return hours * 60 + mins >= 9 * 60 + 30
  ```
  Punching at 09:45 AM via the biometric hardware device results in `status: LATE` (Late after 09:30:00 AM).
- Employees punching on-premise at the physical scanner are unfairly penalized as `LATE`, whereas remote employees using web check-in receive `PRESENT`.

#### Timezone & Day-Boundary Flaws
- In `attendance/route.ts:13-15`:
  ```typescript
  const now = new Date()
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  today.setHours(0, 0, 0, 0)
  ```
  In a Linux Docker container, `process.env.TZ` defaults to UTC (`timezoneOffset === 0`). `now.getHours()` checks UTC hours. In IST (UTC+5:30), 10:00 AM local time corresponds to 04:30 AM UTC. An employee checking in at 02:00 PM IST is evaluated as 08:30 AM UTC and incorrectly recorded as `PRESENT`.

#### Overnight Shift Breakdown
`Attendance` enforces `@@unique([employeeId, date])`. If an employee clocks in for a night shift at 21:00 on Day 1 and checks out at 05:00 on Day 2:
- On Day 2 at 05:00, `today` evaluates to Day 2.
- The web check-in logic finds no record for Day 2 and creates a **new check-in** instead of clocking out the Day 1 shift.
- The Day 1 shift remains with `checkOut: null` indefinitely.

---

## 5. Finding F-05: Leave Balance Architecture Missing

- **Original Severity:** P3 (Low)
- **Validation Status:** **CONFIRMED & UPGRADED TO P1 (HIGH)**
- **Confidence:** Absolute (100%)
- **Affected Module:** Leave Architecture & Dashboard
- **Exact File:** `prisma/schema.prisma`
- **Line Numbers:** Lines 151–180

### Detailed Technical Breakdown

`LeaveType` defines a static field `daysPerYear Int @default(12)`. However:
1. **Zero Balance Tracking:**
   There is no `LeaveBalance` entity, no ledger of accrued days, no monthly credit mechanism, and no carry-forward tracking.
2. **Zero Quota Enforcement:**
   Inspection of `POST /api/leaves` (`src/app/api/leaves/route.ts:8-80`) reveals that neither the application creation logic nor the approval handler checks whether the requested days exceed `LeaveType.daysPerYear` or any accumulated entitlement.
   - An employee can submit a request for 100 consecutive days of leave against an annual quota of 12 days.
   - The API successfully creates the request with status `PENDING`.
   - The manager can approve the request, writing all 100 days as approved leave with zero system alerts.
3. **No Support for Half-Days or Leave Policies:**
   Leave duration is computed strictly as integer days: `Math.round((end.getTime() - start.getTime()) / 86400000) + 1`. Half-day leaves (0.5), hourly permissions, and comp-off accruals are completely unsupported by the schema and controllers.

