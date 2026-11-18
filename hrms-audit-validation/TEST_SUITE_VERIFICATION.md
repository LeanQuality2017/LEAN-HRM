# Test Suite Verification & Test Safety Assessment

**Evaluation Target:** `scripts/validate-workflow.mjs`  
**Test Suite Claimed Baseline:** 50/50 Automated Probes Passing (Suites A1 through K4)  
**Execution Safety Status:** **RUNTIME EXECUTION BLOCKED** (Violates Read-Only & Non-Destructive Audit Constraints)  

---

## 1. Ten-Point Forensic Inspection of `scripts/validate-workflow.mjs`

| # | Inspection Criterion | Verification Finding | Source Code Evidence & Analysis |
|---|---|---|---|
| **1** | **Target Database** | Primary Operational DB | Line 5: `const prisma = new PrismaClient();` initializes Prisma without connection overrides, binding to `process.env.DATABASE_URL` in `.env` (`postgresql://postgres:postgres@localhost:5432/unihr_db`). |
| **2** | **Dedicated Test Database?** | **NO** | There is no separate `unihr_test` database or isolated schema configured. |
| **3** | **Development/Production Exposure?** | **YES** | The script executes directly against the active development container database. |
| **4** | **Creates / Modifies Records?** | **YES** | Creates users (`k4_<ts>@unihr.com`), companies (`probe-del-...`), attendance records, leave requests, and payroll entries. |
| **5** | **Deletes Companies / Employees?** | **YES** | Probes K3 and K4 explicitly create and permanently delete companies and cascade employees. |
| **6** | **Synthetic Test Identities?** | Mixed | Authenticates using permanent seed accounts (`superadmin1@unihr.com`, `admin1@unihr.com`, `hr1@unihr.com`, `manager1@unihr.com`) while generating synthetic throwaway entities for probe tests. |
| **7** | **Irreversible Operations?** | **YES** | Executes hard database deletions (`/api/companies/[id]/delete`) and cascades records. |
| **8** | **Guaranteed Cleanup?** | **NO** | Cleanup calls occur in procedural try/catch blocks. If a test runner encounters an unhandled exception, syntax failure, or abrupt termination, probe companies and orphaned rows remain in the operational database. |
| **9** | **Test Isolation Enforced?** | **NO** | Shared database state means test mutations can collide with concurrent user activity or pollute subsequent probe assertions. |
| **10** | **Validates Security Boundaries?** | **PARTIAL** | Thoroughly tests API endpoint guards and rate limiting, but **completely ignores React Server Component SSR page leaks**. |

---

## 2. Decision on Runtime Execution

### Verdict: **BLOCKED**
Under Section 1 (Strict Rules) and Section 4 of the audit mandate:
> *"Only execute tests after independently establishing that they use an isolated, disposable test database and synthetic data. If that cannot be proved, do not run them. Mark runtime verification as BLOCKED."*

Because `scripts/validate-workflow.mjs` targets the shared primary database and performs real database deletions and mutations, re-executing this script during an audit violates non-destructive constraints. Runtime testing is therefore officially marked **BLOCKED**.

---

## 3. Analysis of Probes K1 through K4 (Step-Up Auth & Hard-Delete)

Probes K1–K4 validate the company hard-delete workflow (`src/app/api/companies/[id]/delete/route.ts`):

- **Probe K1 (Line 1184):** Calls delete with invalid password $\to$ Asserts HTTP 401 and verifies that failed attempt increments the rate limiter.
- **Probe K2 (Line 1218):** Calls delete with valid password but incorrect `confirmName` $\to$ Asserts HTTP 400.
- **Probe K3 (Line 1252):** Creates a throwaway company with no employees $\to$ Calls delete with valid superadmin credentials and correct name $\to$ Asserts HTTP 200, `{ deleted: true }`, and confirms database record is absent via Prisma.
- **Probe K4 (Line 1284):** Creates a throwaway company with an assigned employee and user $\to$ Executes deletion $\to$ Asserts HTTP 200 and verifies that company, employee, and user rows are completely purged.

### Assessment of K1–K4
The assertions for K1–K4 are rigorous and accurate for the API endpoint itself. However, they verify only the happy/unhappy path of the API endpoint, without addressing the fact that tests mutate the shared operational store.

---

## 4. Deconstructing the "50/50 Pass Rate" Claim

The original audit cited the passing 50/50 test suite as proof of "production-grade security." This conclusion is technically flawed for three reasons:

1. **Blindness to React Server Component Leaks:**
   `validate-workflow.mjs` is an HTTP API test client. It sends `fetch()` requests to `/api/*` endpoints. It does not parse or assert on server-rendered HTML from Next.js page components (`/employees`, `/payroll`, `/attendance`, `/leaves/approvals`). Therefore, the massive cross-tenant SSR leaks (F-01, F-06) went completely undetected by the test suite.
2. **False Confidence in Leave Policy:**
   Probe E1 asserts that an employee can apply for leave and receive status `PENDING`. It does not test applying for 100 days of leave against a 12-day balance, masking the complete absence of leave balance quota enforcement (F-05).
3. **Absence of Stale JWT Revocation Tests:**
   The test suite authenticates, receives a session cookie, runs immediate assertions, and exits. It never tests whether a revoked or deactivated user's JWT continues to retain access over its 7-day lifespan (F-07).

