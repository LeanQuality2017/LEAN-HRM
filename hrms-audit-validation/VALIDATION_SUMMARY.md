# UniHR HRMS Audit Validation Summary

**Audit Type:** Independent Second-Stage Codebase, Security, and Architectural Verification  
**Evaluation Target:** UniHR v1.1 (Next.js 16 App Router, React 19, TypeScript, PostgreSQL 16 via Prisma 6)  
**Execution Mode:** STRICT READ-ONLY AUDIT (Zero application mutations, zero database writes, zero git actions)  
**Status:** COMPLETE  

---

## 1. Executive Summary & Revised System Verdict

### Revised System Assessment: **MAJOR FIXES REQUIRED**
*(Downgraded from the initial audit's "Production-Grade" assessment)*

While the UniHR codebase exhibits commendable architectural foundations—notably in its native scrypt password hashing, Next.js 16 Content Security Policy proxy headers, and transactional company deletion sequence—an exhaustive second-stage code verification reveals **critical architectural defects and cross-tenant data leakages** that categorically disqualify the platform from production readiness:

1. **Systemic Multi-Tenant Data Leakage in Server Components (P0):**
   While API mutation routes frequently verify `getScopedCompanyIds()`, **five primary React Server Component pages** (`/employees`, `/payroll`, `/attendance`, `/leaves/approvals`, and `/work-reports`) perform global database queries without tenant scoping for `COMPANY_ADMIN` and `HR` roles. An administrator or HR manager from Company A can view all employee rosters, salary compensation figures, daily attendance timestamps, confidential work reports, and pending leave applications of Company B and Company C.
2. **Broken Session Invalidation & 7-Day Stale JWT Persistence (P0):**
   NextAuth JWT sessions are stateless with a 7-day lifetime (`maxAge: 7 * 24 * 60 * 60`). The middleware proxy and API route guards verify JWT signatures without validating `User.isActive` or the current `User.role` against the database. If an employee is terminated or an administrator is demoted, their existing JWT retains full administrative privileges for up to 7 days.
3. **Absence of Leave Balance Architecture (P1):**
   The database contains no leave balance or accrual model. Neither the UI nor the API validates leave applications against `LeaveType.daysPerYear`. Employees can request unlimited days of leave, and approvals bypass balance restrictions entirely.
4. **Attendance Timezone & Operational Inconsistencies (P1):**
   A 30-minute policy discrepancy exists between web check-in (10:00 AM) and biometric sync (09:30 AM). Furthermore, attendance relies on server-local clock parsing, causing severe timezone drift in containerized environments (UTC vs IST), and the database model (`@@unique([employeeId, date])`) completely breaks overnight and night shifts.
5. **Non-Compliant & Disconnected Payroll Engine (P1):**
   The payroll module applies arbitrary hardcoded formulas ($12\%$ allowances, $5\%$ deductions) with zero attendance or leave integration. An employee marked absent for 30 consecutive days still receives 100% of their base salary. No statutory taxation (TDS), provident fund (EPF), or insurance deductions are implemented.
6. **Non-Isolated Operational Test Suite (P2):**
   The test suite (`scripts/validate-workflow.mjs`) connects directly to the primary operational database without isolation, creating and unlinking real database rows and executing company deletion routines in the active development store.

---

## 2. Status of Original High-Priority Findings (F-01 to F-05)

| Finding ID | Title | Original Severity | Validation Status | Verified Technical Summary |
|---|---|---|---|---|
| **F-01** | Cross-Company Leave Approval Data Leakage | P1 | **CONFIRMED** | `src/app/(app)/leaves/approvals/page.tsx:22-24` omits company scoping for `COMPANY_ADMIN` and `HR`. All pending leaves across all tenant companies are rendered. |
| **F-02** | Leave Type Company Validation Missing | P1 | **CONFIRMED** | `src/app/api/leaves/route.ts:68-76` accepts `leaveTypeId` without verifying that it belongs to the applicant's company, permitting cross-company type injection and 500 errors on invalid foreign keys. |
| **F-03** | In-Memory Rate Limiter Vulnerabilities | P2 | **CONFIRMED & EXPANDED** | Process-local `Map` in `src/lib/rate-limit.ts` fails in multi-instance clusters, lacks background cleanup, and unvalidated `change-password` routes bypass rate limiting entirely. |
| **F-04** | Attendance Timezone & Threshold Inconsistency | P2 | **CONFIRMED & UPGRADED (P1)** | Biometric sync enforces a 09:30 AM late cutoff while web punch enforces 10:00 AM. Server clock UTC offsets break attendance day-boundaries and make overnight shifts impossible. |
| **F-05** | Leave Balance Architecture Missing | P3 | **CONFIRMED & UPGRADED (P1)** | No `LeaveBalance` model exists; neither API nor UI evaluates `daysPerYear`. Employees can apply for unlimited leave days with zero system enforcement. |

---

## 3. High-Risk Vulnerability Matrix

```
[P0: CRITICAL] ──> F-06: Cross-Tenant Data Disclosure in SSR Pages (/employees, /payroll, /attendance, /work-reports)
[P0: CRITICAL] ──> F-07: Stale JWT Privilege Persistence & Inability to Revoke Terminated Accounts (7-day window)
[P1: HIGH]     ──> F-01: Cross-Company Leave Approval Visibility (/leaves/approvals)
[P1: HIGH]     ──> F-02: Unchecked Cross-Company LeaveType Injection (POST /api/leaves)
[P1: HIGH]     ──> F-04: Attendance Threshold Conflict (09:30 vs 10:00) & Overnight Shift Incompatibility
[P1: HIGH]     ──> F-05: Total Absence of Leave Balance & Accrual Tracking
[P1: HIGH]     ──> F-08: Zero Attendance/Leave Integration in Payroll Calculations
[P2: MEDIUM]   ──> F-03: In-Memory Rate Limiting Flaws & IP Spoofing Risk
[P2: MEDIUM]   ──> F-09: Unauthenticated Change-Password Brute Force Attack Surface
[P2: MEDIUM]   ──> F-10: Test Suite Runs Against Operational Database Without Isolation
[P3: LOW]      ──> F-11: Audit Logs Cascaded on User Deletion (Repudiation Risk)
```

---

## 4. Documentation Index

The complete evidence, detailed vulnerability analyses, and remediation blueprints are organized across the following dedicated reports:

1. [`VALIDATION_SUMMARY.md`](file:///x:/LEAN-HRM/hrms-audit-validation/VALIDATION_SUMMARY.md): Executive summary and overall system assessment.
2. [`ORIGINAL_FINDINGS_VERIFICATION.md`](file:///x:/LEAN-HRM/hrms-audit-validation/ORIGINAL_FINDINGS_VERIFICATION.md): Verification and technical deep-dive on F-01 through F-05.
3. [`MULTI_TENANT_SECURITY_AUDIT.md`](file:///x:/LEAN-HRM/hrms-audit-validation/MULTI_TENANT_SECURITY_AUDIT.md): Detailed multi-company scoping and SSR tenant leak analysis.
4. [`AUTHENTICATION_AUTHORIZATION_AUDIT.md`](file:///x:/LEAN-HRM/hrms-audit-validation/AUTHENTICATION_AUTHORIZATION_AUDIT.md): NextAuth JWT lifecycle, revocation gaps, and role enforcement.
5. [`PAYROLL_AND_ATTENDANCE_AUDIT.md`](file:///x:/LEAN-HRM/hrms-audit-validation/PAYROLL_AND_ATTENDANCE_AUDIT.md): Attendance thresholds, shifts, and payroll math verification.
6. [`DATABASE_AND_DATA_INTEGRITY_AUDIT.md`](file:///x:/LEAN-HRM/hrms-audit-validation/DATABASE_AND_DATA_INTEGRITY_AUDIT.md): Prisma schema, cascades, constraints, and audit durability.
7. [`API_AND_SERVER_ACTION_AUDIT.md`](file:///x:/LEAN-HRM/hrms-audit-validation/API_AND_SERVER_ACTION_AUDIT.md): Route handlers, parameter validation, IDOR, and error handling.
8. [`TEST_SUITE_VERIFICATION.md`](file:///x:/LEAN-HRM/hrms-audit-validation/TEST_SUITE_VERIFICATION.md): Analysis of `validate-workflow.mjs` and runtime test safety.
9. [`MISSING_FUNCTIONALITY.md`](file:///x:/LEAN-HRM/hrms-audit-validation/MISSING_FUNCTIONALITY.md): Enterprise HRMS gap analysis against functional benchmarks.
10. [`PRIORITIZED_REMEDIATION_PLAN.md`](file:///x:/LEAN-HRM/hrms-audit-validation/PRIORITIZED_REMEDIATION_PLAN.md): Sequenced implementation roadmap for stabilization.
11. [`EVIDENCE_REGISTER.md`](file:///x:/LEAN-HRM/hrms-audit-validation/EVIDENCE_REGISTER.md): File paths, line numbers, and code snippet evidence registry.

