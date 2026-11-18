# Prioritized Engineering Remediation Plan

This plan establishes a sequenced, prioritized roadmap for engineering teams to resolve all validated vulnerabilities and architectural deficiencies.

---

## Phase 1: P0 Critical Hotfixes (Zero-Day Data Leakage & Session Security)

### Task 1.1: Multi-Tenant Tenant Scoping in React Server Components
- **Priority:** P0 (Critical)
- **Target Files:**
  - `src/app/(app)/employees/page.tsx`
  - `src/app/(app)/payroll/page.tsx`
  - `src/app/(app)/attendance/page.tsx`
  - `src/app/(app)/leaves/approvals/page.tsx`
  - `src/app/(app)/work-reports/page.tsx`
  - `src/app/(app)/recruitment/page.tsx`
  - `src/app/(app)/performance/page.tsx`
- **Action:**
  1. Import `getScopedCompanyIds` from `@/lib/api-auth`.
  2. Retrieve `scopedCompanyIds` using the session user's role, `userId`, and `employeeId`.
  3. If `scopedCompanyIds !== null`, inject `assignments: { some: { companyId: { in: scopedCompanyIds } } }` (or `companyId: { in: scopedCompanyIds }`) into the Prisma query's `where` clause.
- **Verification:** Log in as `hr1@unihr.com` (Alpha Technologies) and verify that no employees, payslips, attendance records, or leaves from Beta Solutions (`BETA`) or SkillEdge appear.

---

### Task 1.2: Real-Time Account Validity & Stale JWT Invalidation
- **Priority:** P0 (Critical)
- **Target File:** `src/lib/api-auth.ts` (and `src/proxy.ts`)
- **Action:**
  1. In `requireAuth()`, execute a lightweight database query against `User`:
     ```typescript
     const liveUser = await db.user.findUnique({
       where: { id: session.user.id },
       select: { isActive: true, role: true },
     })
     if (!liveUser || !liveUser.isActive) {
       throw new ApiError(401, 'Session revoked: account inactive')
     }
     ```
  2. Use `liveUser.role` rather than `session.user.role` for permission evaluation.
- **Verification:** Deactivate a user via database (`isActive = false`) and verify that subsequent API requests using their existing session cookie return HTTP 401 Unauthorized immediately.

---

## Phase 2: P1 High-Priority Fixes (Core Business & Domain Integrity)

### Task 2.1: Enforce Leave Type Tenant Scoping & Existence
- **Priority:** P1 (High)
- **Target File:** `src/app/api/leaves/route.ts`
- **Action:**
  1. Before calling `db.leaveRequest.create()`, query `db.leaveType.findFirst()` matching `id: body.leaveTypeId` and `companyId: primary.companyId`.
  2. If not found or if the company does not match, throw `ApiError(400, 'Invalid leave type for employee organization')`.
- **Verification:** Submit `POST /api/leaves` with an invalid `leaveTypeId` or a `leaveTypeId` from another company; verify clean HTTP 400 Bad Request response.

---

### Task 2.2: Standardize Attendance Policy Thresholds & Timezone Normalization
- **Priority:** P1 (High)
- **Target Files:**
  - `src/app/api/attendance/route.ts`
  - `src/app/api/attendance/sync/route.ts`
- **Action:**
  1. Harmonize late check-in threshold across web and biometric sync to a single standardized time (e.g. 09:30 AM or 10:00 AM).
  2. Extract local time based on explicit company timezone configuration rather than host server `now.getHours()`.
  3. Store normalized date strings `YYYY-MM-DD` to avoid UTC day-boundary slippage.

---

### Task 2.3: Attendance & Leave Integration in Payroll Engine
- **Priority:** P1 (High)
- **Target File:** `src/app/api/payroll/route.ts`
- **Action:**
  1. In `POST /api/payroll`, query total working days in the pay period.
  2. Query `Attendance` to count `PRESENT`, `HALF_DAY`, and approved `LEAVE` days.
  3. Deduct unpaid absent days (Loss of Pay) from the calculated basic salary before generating payroll line items.

---

## Phase 3: P2 Medium-Priority Hardening (Security & Test Architecture)

### Task 3.1: Isolated Test Database & Clean Test Environment
- **Priority:** P2 (Medium)
- **Target File:** `scripts/validate-workflow.mjs`
- **Action:**
  1. Configure the test suite to connect strictly to `unihr_test` or an ephemeral container instance.
  2. Enforce teardown hooks to guarantee cleanup of all synthetic probe entities.

---

### Task 3.2: Distributed Rate Limiter & Change-Password Protection
- **Priority:** P2 (Medium)
- **Target Files:**
  - `src/lib/rate-limit.ts`
  - `src/app/api/auth/change-password/route.ts`
- **Action:**
  1. Replace in-memory `Map` with Redis or database-backed rate limit tracking.
  2. Integrate rate limiting into `POST /api/auth/change-password` on failed `currentPassword` checks.
  3. Validate upstream reverse proxy IP headers before trusting `x-forwarded-for`.

---

## Phase 4: P3 Low-Priority Hardening (Audit Durability & Schema Completeness)

### Task 4.1: Eliminate Audit Log Cascade on User Deletion
- **Priority:** P3 (Low)
- **Target File:** `prisma/schema.prisma`
- **Action:**
  1. Alter `AuditLog.user` relation from `onDelete: Cascade` to `onDelete: Restrict` or `onDelete: SetNull`.
  2. Run `npx prisma db push` to persist the non-repudiation constraint.

---

### Task 4.2: Add Comprehensive Leave Balance Model
- **Priority:** P3 (Low)
- **Target Files:**
  - `prisma/schema.prisma`
  - `src/app/api/leaves/route.ts`
- **Action:**
  1. Introduce model `LeaveBalance` (`employeeId`, `leaveTypeId`, `year`, `allocated`, `used`, `carriedOver`).
  2. Deduct days on approval and enforce balance checks before allowing leave application submission.

