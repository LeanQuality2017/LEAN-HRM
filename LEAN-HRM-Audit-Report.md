# LEAN-HRM (UniHR) — Code Audit & Production Readiness Report

**Repo:** github.com/LeanQuality2017/LEAN-HRM (main, commit 00a7167)
**Audit date:** 19 Nov 2026
**Method:** Full repo clone → `npm ci` → `prisma generate` → `npx tsc --noEmit` → `npx eslint .` → `npx next build` → `npm audit` → manual code review of all 152 source files, 32 API routes, 28 Prisma models, auth/tenant/payroll logic.
**Codebase size:** ~17,084 LOC (TS/TSX), 102 components, 28 DB models, 2 migrations.

---

## 1. Verdict (one line)

> **Architecture & security: strong (above typical market standard).**
> **Payroll & compliance: not real yet.**
> **Tests: almost zero.**
> → **Ready as an "Attendance + Leave + Employee Portal" SaaS. NOT ready as a payroll HRMS in production.**

| Area | Score | Status |
|---|---|---|
| Architecture & code quality | 80/100 | ✅ Good |
| Security (auth/tenant/CSP) | 78/100 | ✅ Good, 4 gaps |
| Attendance / Leave / Portal | 65/100 | ⚠️ Core works, enterprise features missing |
| Payroll & statutory (PF/ESI/PT/TDS) | 25/100 | ❌ Placeholder logic only |
| Test coverage | 15/100 | ❌ No test runner installed |
| DevOps / CI-CD / observability | 45/100 | ⚠️ Docker good, no CI, no monitoring |
| **Overall production readiness** | **~55/100** | ⚠️ Conditional |

---

## 2. What is genuinely GOOD (keep it, don't touch)

1. **Verified clean build** — `next build` passes, `tsc --noEmit` **0 errors** (strict mode), ESLint only 2 minor errors, `npm audit` → **0 vulnerabilities** in production deps.
2. **Modern, sane stack:** Next.js 16 (App Router, RSC) + React 19 + TypeScript (strict) + Prisma 6 + PostgreSQL 16 + Tailwind 4 + shadcn/Radix.
3. **Real auth hardening** (this is better than most freelance HRMS codebases):
   - `scrypt` password hashing with per-user salt + `timingSafeEqual` (`src/lib/password.ts`)
   - Login rate limiting: 5 failed / 15 min per email+IP (`src/lib/rate-limit.ts`)
   - **Step-up credential verification** for destructive SUPER_ADMIN actions (`verifySuperadminStepUp`)
   - Live DB check on every request — deactivated user's JWT dies immediately (`getLiveUser` + `getAuth`)
   - Production hard-stop if `NEXTAUTH_URL` is not HTTPS
4. **Proper multi-tenant design:** `UserCompanyScope` (admin scope) vs `EmployeeCompanyAssignment` (employment scope), with `assertCompanyInScope()` fail-closed to `[]`, not `null`. This is the correct pattern and it is genuinely hard to get right.
5. **Security headers + CSP with per-request nonce** in `src/proxy.ts` (Next.js 16 middleware), plus `X-Frame-Options: DENY`, `nosniff`, Permissions-Policy, `poweredByHeader:false`.
6. **Zod validation on every API input**, central `handle()` error wrapper, typed `ApiError`, pagination helper, audit logging on mutations.
7. **Docker done right:** multi-stage build, `standalone` output, **non-root user (uid 1001)**, `.env` deleted from the image, mounted `HEALTHCHECK`, separate migrate service with `depends_on: service_completed_successfully`.
8. **Feature gates** (`src/lib/feature-gates.ts`) that hard-disable payroll & institute in `NODE_ENV=production`. Honest engineering — you gated a half-built module instead of shipping it. Keep this.
9. **Zero hardcoded secrets**, zero `console.log`, zero `@ts-ignore`, zero TODO/FIXME left in `src/`.
10. **Your own audit docs** (`hrms-audit-validation/*.md`, 1,351 lines) are accurate, and the P0 items in them (tenant scoping in RSC pages, stale-JWT invalidation, leave-type scoping) are **actually fixed in code** — I verified each one. That's rare discipline.

---

## 3. What is WRONG — by severity

### 🔴 P0 — Live-la block pannum (must fix before go-live)

| # | Issue | Evidence | Why it blocks |
|---|---|---|---|
| 1 | **Payroll is placeholder math** | `src/app/api/payroll/route.ts`: `allowances = baseSalary * 0.12`, `deductions = baseSalary * 0.05` | No salary structure, no PF/ESI/PT/TDS, no attendance/LOP, no arrears, no F&F. This is not payroll — it's a formula. Any real client will reject it on day 1. |
| 2 | **Payroll & Institute are hard-disabled in production** | `feature-gates.ts`: `if (process.env.NODE_ENV === 'production') return false` | So in prod, `/payroll` redirects to dashboard and `POST /api/payroll` returns 403. You cannot demo or sell payroll in production at all. |
| 3 | **No test runner exists** | `package.json` has no `test` script; no vitest/jest/playwright | Payroll = money code. Zero automated tests on money code = guaranteed salary disputes. Your `.mjs` scripts are ad-hoc, not regression tests. |
| 4 | **AuditLog cascade-deletes with User** | `schema.prisma`: `user User @relation(... onDelete: Cascade)` on `AuditLog` | Delete one user → **their entire audit trail vanishes**. That destroys legal/DPDP evidence and defeats the purpose of an audit log. Must be `onDelete: Restrict` + `userId String?` |
| 5 | **No password reset / email delivery at all** | grep: no `nodemailer`/`resend`/`sendgrid`/smtp anywhere | Employee forgets password → only SUPER_ADMIN can reset. No payslip email, no leave-approval email, no invite email. Not usable by a real client. |

### 🟠 P1 — Enterprise client-ku thevai (fix within 30 days)

| # | Issue | Evidence | Fix |
|---|---|---|---|
| 6 | **No document/file storage** | grep: zero `upload`/`S3`/`writeFile`/`FormData` handling | Documents, resumes, offer letters, contracts, tax proofs all impossible. Add S3 presigned upload + `Document` model with expiry. |
| 7 | **Rate limiter is in-memory `Map`** | `rate-limit.ts` | Per-instance only; resets on restart; useless with 2+ containers. Move to Redis (Upstash/ioredis) or DB table. |
| 8 | **Single shared biometric API key, no device identity** | `attendance/sync/route.ts` uses one `BIOMETRIC_API_KEY` | One leaked key = full attendance write access for all companies. No per-device key, no rotation, no timestamp/replay protection, no IP allowlist. |
| 9 | **Server-timezone dependent attendance** | `isCheckInLate()` uses `hours*60+mins >= 570` on the raw string / `new Date().getHours()` | Multi-branch client in Dubai + Chennai will get wrong late marks. Add `Company.timezone` and `IST`-normalised `YYYY-MM-DD` date column. |
| 10 | **Attendance unique constraint breaks multi-company & overnight shifts** | `@@unique([employeeId, date])` — `companyId` excluded | A shared employee working for Alpha + Beta cannot have 2 attendance rows. Night shift check-out next day = same `date` collision. Change to `@@unique([employeeId, companyId, date])` + separate shift-window logic. |
| 11 | **No leave balance model** | `LeaveType.daysPerYear` exists but is never read | No accrual, no carry-forward, no expiry, no balance check on apply. Employee can take unlimited leave today. |
| 12 | **No Holiday / Shift / Regularisation models** | grep: no `Holiday`, `Shift`, `Regulariz` in schema | Fixed 9:30 AM assumption. No holidays, no rosters, no missed-punch correction → payroll LOP will be wrong. |
| 13 | **Weak password policy + no MFA** | `validation.ts`: min 8, 1 letter + 1 digit | For payroll data, require 10+, complexity, and TOTP MFA for SUPER_ADMIN/HR. |
| 14 | **No CI/CD** | `.github` does not exist | Every push is untested. Add GitHub Actions: `tsc`, `eslint`, `prisma validate`, `next build`, `migrate diff` check. Free and 30-min job. |
| 15 | **`db:push --accept-data-loss` script + only 2 migrations** | `package.json`, `prisma/migrations/` | Someone will run `db:push` on prod and silently drop columns. Remove the script; enforce `prisma migrate deploy` only. |

### 🟡 P2 — Polish / hygiene

| # | Issue |
|---|---|
| 16 | **`LEGACY_PERSON_NAMES` hardcoded in `src/lib/auth.ts`** — 13 demo names being rewritten to role labels at runtime. That's a data-migration bandaid living in auth code. Do a one-time SQL update, delete the array. |
| 17 | **No `Strict-Transport-Security` header** (`next.config.ts` has 4 headers, missing HSTS) |
| 18 | **`noImplicitAny: false` + `skipLibCheck: true`** in tsconfig — weakens the "strict" claim |
| 19 | **`npm start` uses `bun`, Docker uses `node`** (`"start": "NODE_ENV=production bun .next/standalone/server.js"`) — bun isn't in the Docker image. Inconsistent; make it `node` everywhere. |
| 20 | **2 ESLint errors** — `src/hooks/use-mobile.ts:14` setState in effect (+1 elsewhere) |
| 21 | **No observability**: no Sentry/OpenTelemetry, no structured logs, `/api/health` returns `{ok:true}` without DB check |
| 22 | **`docker-compose.yml` hardcodes `unihr/unihr` DB creds** — move to `.env` / Docker secrets |
| 23 | **No pagination on institute pages** — `feePayment.findMany({ take: 300 })`, students unbounded |
| 24 | **No idempotency key on bulk operations** (payroll batch) — unique constraint saves you, but no request-level guard |
| 25 | **No API versioning** (`/api/v1`) — future breaking change breaks all clients |
| 26 | **Backup is manual only** (runbook command, no cron/systemd timer, no restore drill log) |

---

## 4. Improvement plan — in this order

### Phase 1 — "Sellable & safe" (2–3 weeks) 🔴
1. **Payroll Engine v2** (the real work):
   - `SalaryStructure` model (CTC breakup: basic/HRA/special/conveyance, % based)
   - `PayRule` per company (working days, LOP rate, OT multiplier, cutoff day)
   - `EmployeeSalaryRevision` (history — never overwrite `baseSalary`)
   - `StatutoryProfile` (PF applicable + EPS cap, ESI, PT state, TDS regime)
   - Monthly run: attendance + approved leaves → LOP → gross → PF (12%/₹15k cap) → ESI (0.75/3.25, ₹21k ceiling) → PT slab → TDS → net
   - **All money math in `Prisma.Decimal` / `decimal.js`, never float**
   - Payslip PDF (you already have `docx` — add `@react-pdf/renderer` or puppeteer)
2. **Fix AuditLog cascade** → `onDelete: Restrict`, nullable actor, immutable table.
3. **Add email** (Resend or AWS SES) → password reset, invite, leave status, payslip.
4. **Add Vitest + 40 payroll test cases**: mid-month join/exit, LOP, arrears, PF ceiling boundary, ESI boundary, PT slabs, F&F, gratuity.
5. **GitHub Actions CI** — block merge on type/lint/build failure.
6. **Redis rate limiter** + HSTS + remove `db:push` script + fix HSTS/`noImplicitAny`.
7. **Remove `LEGACY_PERSON_NAMES`** via one-time data migration script.

### Phase 2 — "Enterprise features" (3 weeks) 🟠
8. `Document` module: S3 presigned upload, ID proof / degree / contract / tax proof, expiry alerts.
9. Leave engine: `LeaveBalance`, accrual cron (node-cron / BullMQ), carry-forward, half-day/hourly, comp-off.
10. `Holiday` + `Shift` + `Roster` models; fix `Attendance` unique → `[employeeId, companyId, date]`; overnight shift support.
11. Attendance regularisation request workflow (with audit).
12. Per-device biometric keys (`Device` model, hashed key, rotation, IP allowlist, replay window).
13. Per-company timezone (`Company.timezone`), store `Attendance.date` as normalised `DATE` type.
14. Onboarding/exit: resignation → notice → clearance → relieving + experience letter PDF.

### Phase 3 — "Production hardening & compliance" (2 weeks) 🟡
15. Reports: PF ECR, ESI return, PT challan, 24Q TDS, NEFT/HSBC/HDFC bank bulk file.
16. Sentry + structured logs (pino) + `/api/health` deep check (DB ping) + uptime monitor.
17. Automated nightly `pg_dump` to S3 + **monthly restore drill** (document it).
18. DPDP Act 2023: consent record, data-retention policy (attendance 3 yrs, payslip 3 yrs, audit 1 yr), data export & delete-request endpoints, PII masking in UI.
19. API versioning `/api/v1`, idempotency keys, OpenAPI spec.
20. **2-month parallel payroll run** against the client's existing Excel/software before cutover. This single step catches 90% of real bugs.

---

## 5. Live production checklist (tick these before go-live)

**Infra**
- [ ] `NEXTAUTH_SECRET` = `openssl rand -base64 32` (unique per env)
- [ ] `BIOMETRIC_API_KEY` rotated, per-device keys issued
- [ ] `DATABASE_URL` with `?connection_limit=15&sslmode=require`
- [ ] Postgres **managed** (RDS/Neon/Supabase) with PITR backups — not the compose container
- [ ] Nginx/Caddy TLS + **HSTS** + rate limit at edge; app port 3000 not public
- [ ] `docker compose exec app whoami` → **not root** ✅ (already correct)

**App**
- [ ] `ENABLE_DEMO_MODULES` **not set** in prod → payroll gate stays closed until Phase 1 done
- [ ] Seed **never** run in prod (`ALLOW_DEMO_SEED` guard ✅ already present)
- [ ] `prisma migrate deploy` only; `db:push` script deleted
- [ ] Password reset flow live; email domain SPF/DKIM verified
- [ ] MFA enabled for SUPER_ADMIN/HR
- [ ] Sentry DSN wired; error + slow-query alerting on
- [ ] `/api/health` checks DB; external uptime monitor on it

**Process**
- [ ] UAT sign-off by HR + Finance + 1 employee (written)
- [ ] 2 months payroll parallel run = 100% match
- [ ] Statutory report format verified by client's CA
- [ ] Restore drill done once, documented, timed
- [ ] Privacy policy + DPDP consent + retention doc published
- [ ] Rollback plan: previous image tag + migration rollback script
- [ ] On-call/support owner + escalation matrix agreed

---

## 6. Honest bottom line

UniHR's **foundation is genuinely above market** — the auth, tenant scoping, CSP, Docker and validation layers are things I usually have to write in from scratch on freelance HRMS codebases. Your audit docs are honest, which means you already know where the gaps are.

The gap is **not code quality — it's the payroll domain**. Right now it's a **very well-built attendance & employee portal** with a payroll-shaped hole. Fix Phase 1 (payroll engine + tests + audit-log cascade + email) and this becomes sellable to a real client. Ship it today as payroll HRMS and the first salary cycle will break trust.

**Effort estimate:** Phase 1 ≈ 2–3 weeks solo · Phase 2 ≈ 3 weeks · Phase 3 ≈ 2 weeks ⇒ **~7–8 weeks to a defensible production payroll HRMS.**
