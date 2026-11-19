# UniHR — Agent Context File (read this first)

Always read and comply with antislop.md — mandatory for all development.

Unified multi-company HRMS for a group of 3 companies: 2 normal (Alpha Technologies, Beta Solutions) + 1 training & placement institute (SkillEdge Academy). All employees get login credentials; the system monitors attendance, work (daily EOD reports reviewed by managers), leave, payroll, recruitment, performance, and the full institute pipeline (students, courses, batches, fees, assessments, placements).

## Non-negotiable constraints
1. **UI stays simple.** Functional tables + forms. No redesigns, no fancy animations. Upgrade later.
2. **Workflow performance is king.** Server-side auth checks on every route, DB unique constraints, transactions for multi-step writes, indexes on FK columns, pagination on lists.
3. All status values come from `src/lib/constants.ts`. Always use the shared status constants where defined; never hardcode a status string.
4. Passwords: scrypt via `src/lib/password.ts` (node:crypto). No new deps for hashing.
5. Do not remove or bypass role checks in `src/lib/api-auth.ts` or `src/proxy.ts`.

## Stack & requirements
- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · shadcn/ui (in `src/components/ui/`)
- PostgreSQL 16 · Prisma 6 · NextAuth v4 (JWT credentials, role in token)
- Requires Node 20+. Run with `npm run dev` (port 3001).

## Local development reference
Listing installation or startup commands below is for documentation only and does not authorize the agent to run them.

```bash
# .env must contain valid PostgreSQL and NextAuth configuration:
# DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<dbname>"
# NEXTAUTH_SECRET=<any-long-random-string>
npm install
npx prisma generate
npm run dev                   # http://localhost:3001
```

- `prisma/seed.ts` is destructive by design and triple-guarded (`NODE_ENV`, `ALLOW_DEMO_SEED=true`, DB-name allowlist). A passing guard, an environment flag, and matching database identifiers do not substitute for owner approval or verified isolation.
- Test fixtures go through `scripts/tests/fixtures.mjs` with `TEST_DATABASE_URL` strictly separate from the operational `DATABASE_URL`, targeting `unihr_test` only (container `unihr-test-db`, host port 5433, user `unihr_tester`). If `scripts/tests/gate-test-db.mjs` rejects an existing test database, stop and report; do not clear it or bypass the gate.

## Architecture map
- `prisma/schema.prisma` — Models include: Company, Department, User, UserCompanyScope (delegated company administration), Employee, EmployeeCompanyAssignment (employment relationship; distinct from administrative authority), Attendance, LeaveType, LeaveRequest, Payroll, DailyWorkReport, WorkReportComment, JobOpening, JobApplication, PerformanceReview, KPI, Student, Course, Batch, StudentEnrollment, FeePayment, Assessment, AssessmentResult, Placement, Announcement, Notification, AuditLog (event logging)
- `src/lib/` — db.ts (Prisma singleton), auth.ts (NextAuth config), api-auth.ts (route guards), constants.ts (roles/statuses), password.ts, utils.ts
- `src/app/api/` — ~25 route handlers. Every handler: verify session via api-auth → role check → zod-validate → db op.
- `src/app/(app)/` — role-aware pages: dashboard, employees, companies, leaves (+approvals), attendance, payroll, work-reports, recruitment, performance, profile, announcements, institute/{students,courses,assessments,fees,placements}
- `src/app/login/` — login page. `src/proxy.ts` — route protection middleware.
- `prisma/seed.ts` — full demo dataset (3 companies, users, 7 days attendance, EODs, payroll, ATS, institute pipeline)

## Roadmap (v1.1+) — P1–P5 done; P6 Phase 1 done — execute one phase per task, in order
- **P1 Hardening**: rate-limit login, audit-log model (who did what), change-password for non-admin users, zod validation on every mutation.
- **P2 Biometric sync**: `POST /api/attendance/sync` secured by API key header; device pushes punches; idempotent via `@@unique([employeeId, date])`; source=BIOMETRIC.
- **P3 Exports**: CSV export for attendance/payroll/students/fees; printable payslip.
- **P4 PWA polish**: install prompt, offline shell, app icons already in `public/icons/`.
- **P5 Performance**: add indexes on all FK columns, pagination everywhere, React Query for list caching.
- **P6 Production**: PostgreSQL provider is already present in source; env-based secrets, HTTPS deploy.

## Agent rules
- Never commit, push, or install without explicit Owner instruction; one phase at a time.
- One phase per task. Finish → verify → report. Never leave the app in a non-compiling state.
- `prisma migrate dev` is only for explicitly owner-approved migration work against a verified isolated development database. It is not a startup or production command. `prisma db push` is forbidden in this repository. Production migrations require separate release approval.
- Verify changes by actually hitting the routes/pages as the relevant roles before reporting done.
- Report format always: WHAT CHANGED / FILES TOUCHED / HOW VERIFIED / ISSUES.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
