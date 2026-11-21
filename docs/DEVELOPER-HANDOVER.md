# UniHR (LEAN-HRM) — Developer Handover & System Architecture Guide

**Version:** 2.1 (Post-Audit Remediation & Attendance/Shift Engine Wiring)  
**Target Audience:** Any incoming software engineer, technical lead, or auditor.  
**Objective:** Provide a 100% complete, zero-ambiguity understanding of the UniHR platform from first principles.

---

## 1. Executive Project Overview

**UniHR** is a unified multi-company Human Resource Management System (HRMS) built for a commercial group of three interconnected companies:
1. **Alpha Technologies (`ALPHA`)**: Standard software & IT services enterprise.
2. **Beta Solutions (`BETA`)**: Standard consulting and operations enterprise.
3. **SkillEdge Academy (`SKILLEDGE`)**: A training and placement institute that manages both conventional employees (instructors/staff) and a full educational pipeline (students, courses, batches, fees, assessments, and corporate placements).

### Core System Capabilities
- **Multi-Tenant / Multi-Company Separation**: Unified login for all employees, HR, and executives across group companies with strict cryptographic and database tenant isolation.
- **Attendance & Shift Classification Engine**: Real-time evaluation of web and biometric punches against shift windows, grace periods, overnight cutoffs, overtime, and holiday schedules.
- **Leave Management & Balances**: Transactional leave requests, balance tracking with carry-forward, accrual rules, and automatic LEAVE attendance record generation.
- **Payroll Engine v2**: Deterministic statutory payroll (TDS regimes, PF, ESI, professional tax) calculated strictly using `Prisma.Decimal` arbitrary-precision arithmetic.
- **Recruitment (ATS)**: Job openings, applicant tracking, and status pipeline.
- **Performance & Reviews**: Key Performance Indicators (KPIs), manager/employee reviews, and ratings.
- **Work Reports**: Daily End-of-Day (EOD) work reports reviewed and commented on by reporting managers.
- **Institute Pipeline**: Student admissions, course enrollments, batch management, fee receipts, assessments, and corporate placements.
- **Audit & Governance**: Append-only transactional audit logging for all mutations and sensitive actions.

---

## 2. Technology Stack & Operational Baseline

| Layer | Technology | Version | Rationale & Rules |
| --- | --- | --- | --- |
| **Framework** | Next.js (App Router, Turbopack) | `16.4.5` | Standalone server output; App Router Route Handlers and Server Components. |
| **UI Library** | React | `19.3.1` | Modern server-component architecture. |
| **Language** | TypeScript | `5.9.3` | Strict type checking (`strict: true`, zero `any`, zero `@ts-ignore`). |
| **Styling** | Tailwind CSS + shadcn/ui | `4.3.3` | Functional, clean enterprise UI without bloated animations. |
| **Database** | PostgreSQL | `16` | Relational storage with foreign key constraints, check constraints, and compound unique keys. |
| **ORM** | Prisma ORM | `6.19.3` | Explicit schema migrations, strong typing, and transactional client. |
| **Authentication** | NextAuth.js | `4.24.15` | JWT session credentials provider; role and employeeId stored in session token. |
| **Password Hashing** | Node.js `node:crypto` (`scrypt`) | Native | Built-in salted scrypt hashing (`N=16384, r=8, p=1`). No external native dependencies. |
| **Validation** | Zod | `4.6.7` | Strict runtime schema parsing on every mutation endpoint via `validateBody()`. |
| **Testing** | Vitest | `5.1.1` | 21 test suites, 224 unit and integration tests passing in under 2 seconds. |

---

## 3. Domain Model & Database Schema

The schema is defined in `prisma/schema.prisma` across 32 models.

### Key Architectural Distinctions: Scope vs. Assignment
One of the most critical domain invariants in UniHR is the distinction between **administrative authority** and **employment link**:
- **`UserCompanyScope` (Administrative Authority)**: Dictates which companies a user is authorized to manage or view (e.g. an HR admin scoped to manage Alpha and Beta).
- **`EmployeeCompanyAssignment` (Employment Link)**: Dictates which company an employee is formally employed by, their designation, joining date, and whether it is their primary employment.
- **Helper Contract (`src/lib/api-auth.ts`)**:
  - `getScopedCompanyIds(auth)`: Returns `null` for `SUPER_ADMIN` (unrestricted group-wide access), or `string[]` for scoped admins.
  - `assertCompanyInScope(companyId, scopedIds)`: Throws `ApiError(403, 'Forbidden: company out of scope')` if an admin attempts cross-tenant manipulation.

```
+-----------------------------------------------------------------------------------------+
|                                    DOMAIN ENTITIES                                      |
+-----------------------------------------------------------------------------------------+
|                                                                                         |
|   +-------------------+          +--------------------+          +------------------+   |
|   |      Company      |<---------| UserCompanyScope   |--------->|       User       |   |
|   | (ALPHA/BETA/SKILL)|          | (Admin Authority)  |          | (Login / Auth)   |   |
|   +-------------------+          +--------------------+          +------------------+   |
|             ^                                                              ^            |
|             |                                                              |            |
|             |  +------------------------------+                            |            |
|             +--|  EmployeeCompanyAssignment   |                            |            |
|                |  (Employment Relationship)   |                            |            |
|                +------------------------------+                            |            |
|                               ^                                            |            |
|                               |                                            |            |
|                     +-------------------+                                  |            |
|                     |     Employee      |----------------------------------+            |
|                     | (Staff Profile)   |                                               |
|                     +-------------------+                                               |
|                               |                                                         |
|         +---------------------+---------------------+--------------------+              |
|         |                     |                     |                    |              |
|         v                     v                     v                    v              |
|  +--------------+      +--------------+      +--------------+     +--------------+      |
|  |  Attendance  |      | LeaveRequest |      |   Payroll    |     | DailyWorkRep |      |
|  |  (Punches)   |      |  & Balances  |      | (Engine v2)  |     |   (EODs)     |      |
|  +--------------+      +--------------+      +--------------+     +--------------+      |
|         |                                           |                                   |
|         v                                           v                                   |
|  +--------------+                            +--------------+                           |
|  | Shift/Holiday|                            |SalaryStruct/ |                           |
|  |  Engine      |                            |StatutoryProf |                           |
|  +--------------+                            +--------------+                           |
+-----------------------------------------------------------------------------------------+
```

---

## 4. Completed Engineering Roadmap (P1–P6 & Attendance Engine)

### Phase 1: Security Hardening & Zero-Trust Governance
1. **API Rate Limiting (`src/lib/rate-limit.ts`)**:
   - Token-bucket in-memory rate limiter protecting sensitive authentication endpoints:
     - Login: 5 attempts per 15 minutes per IP (`loginLimiter`).
     - Password reset & forgot password: 5 attempts per hour (`passwordResetLimiter`).
     - General mutations: 60 requests per minute (`mutationLimiter`).
2. **Immutable Audit Logging (`src/lib/audit.ts`)**:
   - Centralized `logAudit()` function writing to `AuditLog`.
   - Records actor, action (from `AUDIT_ACTIONS`), entity, entityId, timestamp, and metadata snapshot.
   - Executes inside database transactions atomically alongside mutations.
3. **Strict Validation Pipeline (`src/lib/validation.ts`)**:
   - Every POST, PATCH, and mutation route parses untrusted input through Zod schemas using `validateBody()`.
   - Rejects unpadded time strings, malformed dates, invalid numbers, and unknown enum values with structured 400 errors.

### Phase 2: Biometric Sync Architecture (`/api/attendance/sync`)
- **Machine-to-Machine Authentication**: Protected via `x-api-key` header matching `process.env.BIOMETRIC_API_KEY`.
- **Timing-Safe Comparison**: Uses `crypto.timingSafeEqual` to prevent timing attacks.
- **Batch Processing with Individual Failure Isolation**: A batch of up to 500 punches is processed row-by-row; a failure on punch #12 (e.g. employee not found or no shift configured) records an item error in `errors[]` and does not abort the remaining 499 punches.
- **Compound Uniqueness & Idempotent Upsert**:
  - Identified by `@@unique([employeeId, companyId, date])`.
  - Re-running punches does not duplicate records; merges non-null checkIn/checkOut and updates classification.

### Phase 3: Financial Precision, Exports & Security
- **Arbitrary Precision Money (`src/lib/payroll/money.ts`)**:
  - `Number` and `parseFloat` are strictly forbidden for financial calculations.
  - All currency calculations use `Prisma.Decimal` and Minor Unit conversions.
  - API serialization uses `serializeMoney()` ensuring money is transferred safely.
- **Formula Injection Mitigation**:
  - All CSV exports (`/api/export/[type]`) sanitize cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` by prefixing a single quote (`'`).

### Phase 4: Attendance & Shift Classification Engine
The attendance engine was migrated from hardcoded `10:00 AM` threshold checks to a pure, deterministic multi-timezone engine:
1. **Pure Classifier (`src/lib/attendance/classify.ts`)**:
   - Pure function `classifyDay({ dateKey, isHoliday, isWeekoff, punches, shift, timeZone })`.
   - Evaluates:
     - `lateMinutes`: Grace threshold calculation (`startTime + graceMinutes`).
     - `earlyExitMinutes`: Punch-out before `endTime`.
     - `otHours`: Calculated beyond shift duration.
     - `isLop`: Marked true if absent without an approved leave.
     - Status: `PRESENT`, `LATE`, `HALF_DAY`, `ABSENT`, `ON_LEAVE`, `HOLIDAY`, `WEEK_OFF`.
2. **Shift Resolution Cascade (`src/lib/attendance/resolveShift.ts`)**:
   - Checks active `EmployeeShiftAssignment` covering the target date.
   - Falls back to the company's default shift (`isDefault = true`).
   - Throws `ShiftResolutionError` if neither is configured.
3. **Additive Schema Migration**:
   - Added `lateMinutes`, `earlyExitMinutes`, `otMinutes`, `isLop`, `shiftId`, and `classifiedAt` to `Attendance`.
4. **Admin Shift & Holiday Configuration APIs**:
   - `/api/shifts` & `/api/shifts/[id]`:
     - Creates/edits shifts with regex-enforced 24-hr `HH:mm` format.
     - Rejects `startTime === endTime`.
     - Enforces exactly one `isDefault` shift per company by automatically unsetting previous defaults inside a transaction.
     - Referential integrity: `DELETE /api/shifts/[id]` returns 400 if any employee assignment references that shift.
   - `/api/holidays` & `/api/holidays/[id]`:
     - Creates/edits holidays with dates normalized to UTC midnight.
     - Enforces compound uniqueness on `[companyId, date]`.
     - Supports year-based filtering (`/api/holidays?companyId=...&year=2026`).

---

## 5. API Route Directory & Contract Map

All routes are in `src/app/api/` and strictly wrapped with `requireAuth()` and `handle()`.

| Endpoint | Methods | Authorized Roles | Description |
| --- | --- | --- | --- |
| `/api/auth/[...nextauth]` | POST, GET | Public | Credentials JWT login and session management. |
| `/api/auth/forgot-password`| POST | Public | Enumeration-resistant password reset link dispatch. |
| `/api/auth/reset-password` | POST | Public | Verifies token and updates scrypt password hash. |
| `/api/companies` | GET, POST, PATCH | Super Admin / Scoped Admin | Company creation, administration, and listing. |
| `/api/employees` | GET, POST, PATCH | HR / Company Admin | Employee profile and onboarding lifecycle. |
| `/api/assignments` | GET, POST, PATCH | HR / Company Admin | Employment company assignments. |
| `/api/attendance` | GET, POST | All Staff / HR / Admin | Web punch check-in / check-out toggle and list. |
| `/api/attendance/sync` | POST, GET | Biometric Machine / Admin | Machine push punch sync (API key authenticated). |
| `/api/shifts` | GET, POST | Staff (GET) / HR (POST) | Shift listing and creation with default enforcement. |
| `/api/shifts/[id]` | GET, PATCH, DELETE | Staff (GET) / HR (PATCH/DEL) | Shift details, modification, and safe deletion. |
| `/api/holidays` | GET, POST | Staff (GET) / HR (POST) | Holiday calendar management and year queries. |
| `/api/holidays/[id]` | GET, PATCH, DELETE | Staff (GET) / HR (PATCH/DEL) | Holiday modification and removal. |
| `/api/leaves` | GET, POST | Employee / HR | Leave application with atomic balance verification. |
| `/api/leaves/[id]` | PATCH | Manager / HR | Leave approval/rejection and LEAVE attendance row sync. |
| `/api/leaves/balance` | GET | Employee (own) / HR (scoped) | Leave balance query. |
| `/api/payroll` | GET, POST | HR / Company Admin | Payroll generation and state machine transitions. |
| `/api/payroll/[id]/pdf` | GET | Employee (own) / HR | Deterministic payslip PDF download. |
| `/api/work-reports` | GET, POST | Employee / Manager | Daily EOD submission and manager review comments. |
| `/api/jobs` & `/api/applications` | GET, POST, PATCH | HR / Recruiter | Recruitment pipeline and applicant tracking. |
| `/api/students`, `/api/courses` | GET, POST, PATCH | Institute Admin | SkillEdge student admissions and course records. |
| `/api/fees`, `/api/assessments` | GET, POST | Institute Admin | Student fee payments and exam evaluations. |
| `/api/audit` | GET | Super Admin / Admin | Filtered audit trail inspection. |
| `/api/export/[type]` | GET | HR / Admin | Sanitized CSV data exports. |

---

## 6. Local Development & Operational Setup

### Prerequisites
- **Node.js**: `20.x` or `22.x` (LTS)
- **PostgreSQL**: `16` (Running locally on default port 5432 or Docker container)

### Setup Steps
```bash
# 1. Install dependencies
npm install

# 2. Configure Environment (.env)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/unihr_dev?schema=public"
NEXTAUTH_SECRET="your-long-random-secret-key-32-chars-min"
NEXTAUTH_URL="http://localhost:3001"
BIOMETRIC_API_KEY="test-biometric-key-change-in-prod"
STORAGE_PROVIDER="LOCAL" # or "S3"
SMTP_DEV_NOOP="true"     # Logs email dispatch to stdout without SMTP

# 3. Apply Migrations & Generate Prisma Client
npx prisma migrate deploy
npx prisma generate

# 4. (Optional) Disposable Demo Dataset
# Seed is triple-guarded and will ONLY run if ALLOW_DEMO_SEED=true
ALLOW_DEMO_SEED=true npm run seed

# 5. Start Development Server (UniHR runs on port 3001)
npm run dev
```

---

## 7. Verification Discipline & Test Suite

UniHR enforces strict quality and correctness gates before any work is committed.

### The 5 Standard Quality Commands
```bash
# 1. Schema integrity
npx prisma validate

# 2. Type-checking (Zero TypeScript errors required)
npx tsc --noEmit

# 3. Linter (Zero ESLint warnings or errors required)
npx eslint .

# 4. Automated Test Suite (All 224 unit & integration tests must pass)
npx vitest run

# 5. Production Build (Must compile and generate all 36 routes cleanly)
npx next build
```

### Current Test Suite Coverage (21 Test Files, 224 Tests)
- `tests/lib/rate-limit.test.ts` (7 tests)
- `tests/lib/attendance/classify.test.ts` (8 tests)
- `tests/lib/attendance/timezone.test.ts` (13 tests)
- `tests/lib/attendance/resolve-shift.test.ts` (3 tests)
- `tests/lib/attendance/classify-wiring.test.ts` (7 tests)
- `tests/lib/attendance/company-scope.test.ts` (7 tests)
- `tests/app/api/attendance-sync-classify.test.ts` (5 tests)
- `tests/app/api/shifts-holidays.test.ts` (7 tests)
- `tests/app/api/leaves-balance.test.ts` (14 tests)
- `tests/lib/payroll/payroll-engine.test.ts` (24 tests)
- `tests/lib/payroll/payroll-run-resilience.test.ts` (3 tests)
- `tests/lib/payroll/money-serialization.test.ts` (13 tests)
- `tests/lib/payroll/payslip-doc.test.ts` (5 tests)
- `tests/lib/payroll/tds.test.ts` (20 tests)
- `tests/lib/payroll/settlement.test.ts` (10 tests)
- `tests/lib/payroll/state-machine.test.ts` (10 tests)
- `tests/lib/leave/accrual.test.ts` (18 tests)
- `tests/lib/security-isolation.test.ts` (25 tests)
- `tests/lib/password.test.ts` (6 tests)
- `tests/lib/s3.test.ts` (13 tests)
- `tests/lib/mail.test.ts` (6 tests)

---

## 8. Summary for the Incoming Developer

1. **Multi-Tenancy is Strict**: Always scope Prisma queries with `getScopedCompanyIds(auth)` and `assertCompanyInScope(companyId, scopedIds)`. Never query tenant data without scoping.
2. **Never Use Floating-Point for Money**: Always use `Prisma.Decimal` and `serializeMoney()`.
3. **Attendance is Engine-Driven**: Never write hardcoded punch status checks or cutoff hours. Always pass punches through `classifyDay()` and resolve shifts via `resolveShiftForDate()`.
4. **Transactions are Mandatory for Multi-Step Writes**: Leave approvals, payroll processing, shift default flips, and company onboarding must always be wrapped in `db.$transaction()`.
5. **Quality Gates Must Pass**: Before presenting any feature or patch, run `prisma validate`, `tsc --noEmit`, `eslint .`, `vitest run`, and `next build`.

