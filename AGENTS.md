# UniHR — Agent Context File (read this first)

Always read and comply with antislop.md — mandatory for all development.

Unified multi-company HRMS for a group of 3 companies: 2 normal (Alpha Technologies, Beta Solutions) + 1 training & placement institute (SkillEdge Academy). All employees get login credentials; the system monitors attendance, work (daily EOD reports reviewed by managers), leave, payroll, recruitment, performance, and the full institute pipeline (students, courses, batches, fees, assessments, placements).

## Non-negotiable constraints
1. **UI stays simple.** Functional tables + forms. No redesigns, no fancy animations. Upgrade later.
2. **Workflow performance is king.** Server-side auth checks on every route, DB unique constraints, transactions for multi-step writes, indexes on FK columns, pagination on lists.
3. SQLite has no enums → statuses are strings; ALL status values come from `src/lib/constants.ts`. Never hardcode a status string.
4. Passwords: scrypt via `src/lib/password.ts` (node:crypto). No new deps for hashing.
5. Do not remove or bypass role checks in `src/lib/api-auth.ts` or `src/proxy.ts`.

## Stack & requirements
- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · shadcn/ui (in `src/components/ui/`)
- Prisma 6 + SQLite (`db/custom.db`) · NextAuth v4 (credentials, JWT sessions, role in token)
- Requires Node 20+. Run with `npx next dev -p 3000`.
- NOTE: `package.json` dev script pipes to `tee` (breaks on Windows CMD/PowerShell) — use `npx next dev -p 3000` directly, or fix the script for the OS.

## Setup & run (universal)
Postgres must be up before dev/build (`docker compose up -d db` or `npx prisma dev -P 5432`).

```bash
# 1. .env must contain (relative path — Prisma resolves it relative to prisma/):
#    DATABASE_URL="file:../db/custom.db"
#    NEXTAUTH_SECRET=<any-long-random-string>
npm install
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts        # safe to re-run: wipes and recreates all demo data
npx next dev -p 3000          # http://localhost:3000
```

## Demo credentials (all passwords: `Password@123`)
| Email | Role | Scope |
|---|---|---|
| superadmin1@unihr.com | SUPER_ADMIN | All 3 companies, everything |
| admin1@unihr.com | COMPANY_ADMIN | Alpha Technologies |
| hr1@unihr.com | HR | Alpha |
| manager1@unihr.com | MANAGER | Alpha (approves leave, reviews EOD) |
| employee1@unihr.com | EMPLOYEE | Alpha |
| employee2@unihr.com | EMPLOYEE | Alpha |
| admin2@unihr.com | COMPANY_ADMIN | Beta Solutions |
| hr2@unihr.com | HR | Beta |
| manager2@unihr.com | MANAGER | Beta |
| employee3@unihr.com | EMPLOYEE | Beta |
| employee4@unihr.com | EMPLOYEE | Shared employee: works for Alpha AND Beta, single login |
| student1@unihr.com | STUDENT | SkillEdge student portal |
| student2@unihr.com | STUDENT | SkillEdge student portal |

## Architecture map
- `prisma/schema.prisma` — 20 models: Company, Department, User, Employee, EmployeeCompanyAssignment (multi-company shared staff), Attendance, LeaveType, LeaveRequest, Payroll, DailyWorkReport, WorkReportComment, JobOpening, JobApplication, PerformanceReview, KPI, Student, Course, Batch, StudentEnrollment, FeePayment, Assessment, AssessmentResult, Placement, Announcement, Notification
- `src/lib/` — db.ts (Prisma singleton), auth.ts (NextAuth config), api-auth.ts (route guards), constants.ts (roles/statuses), password.ts, utils.ts
- `src/app/api/` — ~25 route handlers. Every handler: verify session via api-auth → role check → zod-validate → db op.
- `src/app/(app)/` — role-aware pages: dashboard, employees, companies, leaves (+approvals), attendance, payroll, work-reports, recruitment, performance, profile, announcements, institute/{students,courses,assessments,fees,placements}
- `src/app/login/` — login page. `src/proxy.ts` — route protection middleware.
- `prisma/seed.ts` — full demo dataset (3 companies, 13 users, 7 days attendance, EODs, payroll, ATS, institute pipeline)

## Roadmap (v1.1+) — P1–P5 done; P6 Phase 1 done — execute one phase per task, in order
- **P1 Hardening**: rate-limit login, audit-log model (who did what), change-password for non-admin users, zod validation on every mutation.
- **P2 Biometric sync**: `POST /api/attendance/sync` secured by API key header; device pushes punches; idempotent via `@@unique([employeeId, date])`; source=BIOMETRIC.
- **P3 Exports**: CSV export for attendance/payroll/students/fees; printable payslip.
- **P4 PWA polish**: install prompt, offline shell, app icons already in `public/icons/`.
- **P5 Performance**: add indexes on all FK columns, pagination everywhere, React Query for list caching.
- **P6 Production**: switch Prisma provider to Postgres (schema is portable), env-based secrets, HTTPS deploy.

## Agent rules
- One phase per task. Finish → verify → report. Never leave the app in a non-compiling state.
- After any schema change: `npx prisma db push` then re-seed if needed.
- Verify changes by actually hitting the routes/pages as the relevant roles before reporting done.
- Report format always: WHAT CHANGED / FILES TOUCHED / HOW VERIFIED / ISSUES.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
