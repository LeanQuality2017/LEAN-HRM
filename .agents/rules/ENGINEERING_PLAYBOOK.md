---
trigger: always_on
description: "Required UniHR engineering rules. Read the full playbook before every task. Stop before implementation if it is inaccessible or a conflict is unresolved."
---

# UniHR Engineering Playbook

**Preflight marker:** `UNIHR-PLAYBOOK-v1`  
**Scope:** Every UniHR analysis, plan, edit, review, test, and release action.  
**Inspected baseline:** `ec4dba10006b4ea0daeae266080ac0a56e630af2` on 18 November 2026, approved by the owner for this playbook. This is not the active Windows checkout or evidence of a deployed configuration.

## 1. Non-negotiable rules

1. Read this entire file at task start and after any new session or context reset. If unavailable, report `Instruction file: Not accessible` and stop before implementation. Do not rely on memory or a summary.
2. Recheck scope, worktree, and target before operating. Preserve all user work, including untracked files. Planning, inspection, and editing authority do not imply database, Git, or release authority. No implied Phase 7 implementation approval.
3. Use source for facts and approved owner decisions for policy. Audit reports are leads, not proof. The baseline [AGENTS.md](../../AGENTS.md) contains stale SQLite and unsafe push/reseed directions; **do not follow those directions**. [antislop.md](../../antislop.md) informs UI craft, not permission to run installers, redesign, or change state. Preserve compatible guidance. Report unresolved conflicts and stop before affected work.
4. Protect secrets and HR data. Do not widen permissions, use real data in tests, or treat UI hiding, successful compilation, or a previous report as proof of correctness. Report failed and unverified checks explicitly.

## 2. Verified baseline and source map

Re-verify the local revision, working changes, and affected files before relying on this map. Owner-reported historical references only: `X:\LEAN-HRM`, `4906bb48222d3ba7047e6cc599ae3e7ad66505ca`, operational `unihr-app`, `unihr-migrate`, `unihr-db`; test resources `unihr-test-db`, `unihr-test-network`. None were inspected here, and their names do not establish isolation. The accepted fixture database may already contain data. Later remediation reports are not verified by this baseline.

| Boundary | Baseline evidence and convention |
| --- | --- |
| Toolchain | `package-lock.json`: Next.js **16.4.3**, React/DOM **19.3.1**, TypeScript **5.9.3**, Prisma/client **6.19.3**, NextAuth **4.24.15**, Zod **4.6.7**, Tailwind **4.3.3**, ESLint **9.39.5**. These are observations, not permanent pins. `next.config.ts` uses standalone output; Docker uses Node 22 and Compose PostgreSQL 16. The package start command and Docker entrypoint differ. Baseline script bodies include `next dev -p 3001`, `next build`, and `eslint .`; verify the local package scripts before use. |
| UI and routing | One App Router application. `src/app/(app)/` contains protected pages and layouts; Server Components sometimes query Prisma directly. Client forms call `src/app/api/` Route Handlers; e.g. `employees/actions.tsx` is a client module, not necessarily a Server Action. Shared shell and shadcn/ui primitives: `src/components/`. No universal service layer is assumed. |
| Identity | `src/lib/auth.ts`: NextAuth credentials, JWT sessions, salted scrypt via `password.ts`. `api-auth.ts` and `page-auth.ts` check live active user and role. `page-guard.ts` maps role/path access; `src/proxy.ts` uses token claims for redirects and sets CSP. These are not resource authorization. Guard coverage is uneven. `rate-limit.ts` is process-local; do not presume MFA, distributed limits, or immediate session revocation. |
| Handler contracts | `src/lib/api-auth.ts`: `requireAuth`, `handle`, `ApiError`. `validation.ts`: Zod `validateBody`. `pagination.ts`: `parsePaginationParams`. Representative successes use `{ ok: true, data }`, errors `{ error }`; confirm each route and its clients. Use `src/lib/constants.ts` for roles, statuses, labels and audit actions. |
| Storage and operations | `prisma/schema.prisma` declares PostgreSQL, with committed migrations and decimal money fields. `src/lib/db.ts` is the shared Prisma client; `audit.ts` can log through a transaction. Baseline audit rows cascade with users. `/api/health` is liveness only. Inspect `DEPLOY.md` and Compose against actual config before any authorized operation. |
| Coverage and verification | Company/employee, attendance, leave, work reports, payroll, recruiting, performance, Institute, announcements, notifications, profile, audit and export routes exist; presence is not completeness. `tsconfig.json` sets `strict` but overrides `noImplicitAny`. ESLint flat config relaxes some rules. `scripts/` has workflow/fixture checks; no package `test` script or tracked CI workflow in this baseline. Audit Markdown is historical. |

## 3. UniHR domain invariants

**Never substitute employment for administrative authority.** `UserCompanyScope` delegates administration; `EmployeeCompanyAssignment` links staff to employers. `getAdministeredCompanyIds` and `getEmployedCompanyIds` represent these separately. In the helper contract, `null` is explicit Super Admin group access; `[]` grants no companies. Missing scope must not drop a query filter. Student visibility is not Institute admin authority.

| Area | Rule to preserve or verify |
| --- | --- |
| People and companies | Check action, role, and resource owner. Shared staff can have one identity and several assignments. One assignment is not authority to edit global identity, scope, compensation, or another company's primary assignment. Authorize source, destination and affected records. Managers need the approved reporting relationship **and** applicable company scope. Keep employment status, account eligibility, and company archival distinct. |
| Attendance, leave and reports | Attendance and reports have company fields and employee/date uniqueness; leave type identifies a company. Never infer historical ownership from current assignments. Preserve reviewer authority, approved transitions and audit. Do not invent shift, site date, accrual, holiday or timezone policy: web and device cutoffs differ in the baseline. Device sync has a distinct machine credential. |
| Payroll and Institute | Baseline payroll is unique by employee/month/year, without a durable issuer. `DRAFT`, `PROCESSED`, and `PAID` are workflow states, not payment evidence. Baseline Student/Course lack an owning institute. Keep existing containment gates; if absent, report the gap. Do not enable live workflows without approved ownership and verified read/write/export policy. Never invent statutory pay rules or backfill issuers from current assignments. |
| Privacy and history | Scope related records, aggregates, dropdowns, dashboards, printouts and CSVs, not just primary queries. Minimize compensation, leave, student and candidate data. Personal notifications belong to the live principal; group broadcasts need explicit authority. Do not treat current memberships as ownership of historical events. |

**Baseline risk paths to recheck:** `src/app/api/assignments/`, `employees/`, and `users/reset-password/`; dashboard/Institute page queries; payroll lists, slips and exports; actor-based audit filters and company deletion; and deployment/seed configuration. Do not treat an old audit, a guarded neighboring route, or a demo UI as proof of remediation.

## 4. Mandatory workflow (Stage 0–9)

Use all applicable stages; scale depth to risk. Read-only work stops before implementation. Mark inapplicable checks with a reason, not a pass.

| Stage | Required action |
| --- | --- |
| **0 · Load** | Read playbook and relevant docs; establish repo, `HEAD`, status, owner decisions and allowed scope. Identify modules and existing work. For substantial tasks, provide §9 preflight. |
| **1 · Understand** | Identify users/roles, inputs, outcomes, exceptions, dependencies, security/data effects and regressions. Ask for consequential missing decisions only after checking source and owner instructions. |
| **2 · Trace** | Inspect only affected files, helpers, queries and tests. Follow UI → server/client boundary → API/action → authentication → authorization → scoped policy/query → response. Include alternate pages, exports, jobs and cache where relevant. |
| **3 · Design** | State problem and existing behavior; proposed solution and boundaries; files edited/added; schema/data, dependency, security and API compatibility impacts; tests, risks, rollback if relevant, and acceptance criteria. Pick the smallest complete change. Stop for §5 approvals before implementation. |
| **4 · Implement** | Recheck target and status. Make small approved changes; reuse native patterns. Preserve unrelated behavior and stable interfaces. Include validation, authorization and tests. Report off-scope discoveries separately. |
| **5 · Self-review** | Read every changed file. Check logic, naming, typing, errors, layering, security, speed, data integrity, concurrency, edge cases and compatibility. Remove debug code, dead code and needless comments. |
| **6 · Test** | Use §8 and existing verified infrastructure. Inspect scripts before execution. Check success and controlled failure. Report failed, skipped and blocked checks without making unrelated changes to pass. |
| **7 · Verify separately** | Recheck each acceptance criterion, security boundary, business rule, API/schema effect and regression risk against source and results. Seek another reviewer for sensitive changes if available; do not claim independent review you did not get. |
| **8 · Report** | Use §9. Give what/why, decisions, changed files, data/security effects, exact test results, limitations and required owner action. |
| **9 · Release** | Inspect staged/unstaged status read-only. Provide evidence and wait for the owner's separate Git/release authorization, even when all tests pass. |

## 5. Approval and environment gates

| Activity | Required boundary |
| --- | --- |
| Git and files | Read-only inspection allowed. Preserve modified/untracked work. No stage, commit, branch/worktree change, stash, remote Git operation, merge or history rewrite without separate approval. Never reset, clean, or discard user work. |
| Policy and architecture | Obtain explicit approval before expanding task scope, changing architecture, permissions, identity, business policy, contracts, schemas or data, or undertaking destructive operations. Explain purpose, affected modules, risks and migration impact. |
| Operations and tooling | New dependencies, unapproved upgrades, service changes, release toggles, deployments and production access require approval. Read scripts and their inputs/defaults first; a runbook is not authorization. |
| Database | Approve mutations explicitly, including fixture setup. Confirm host/container/network, database, role, isolation and existing data for **both the app and runner**; names such as `test` are insufficient. Use a disposable least-privilege target and synthetic data. Never substitute `DATABASE_URL` for a verified test connection. Stop if target is uncertain. |

**Inspect before use:** `scripts/validate-workflow.mjs` includes app writes; `prisma/seed.ts` clears data; `scripts/tests/fixtures.mjs` contains truncation. `scripts/tests/gate-test-db.mjs` checks database/host/role and expects an empty public schema; existing fixtures can fail that check. `scripts/tests/probe-test-db.mjs` is a check, not authorization. Never bypass gates, clear an existing DB to satisfy a test, or run destructive Docker/volume cleanup. Baseline `db:push` uses `--accept-data-loss`, and `db:reset` erases data: neither is a quality gate. Never request, print or copy secret values; let the owner configure them outside the agent.

## 6. Design, backend and frontend standards

- **Code and architecture:** Prefer focused typed functions, meaningful names, explicit dependencies and predictable side effects. Keep policy outside presentation, centralize real duplication, avoid cycles and a second architecture. Apply SOLID, DRY, KISS, YAGNI and composition where they solve a real problem. Reuse native imports, naming, contracts and formatting. Comments explain why. No new `any`, unsafe assertions, suppressed warnings or ignored failures to hide defects. Narrow unavoidable exceptions must be justified, reviewed and documented. Keep affected docs/contracts current within scope. Do not obscure AI involvement or imitate someone else’s authorship.
- **API:** Use a live server principal, action and resource authorization, Zod validation of untrusted body/query/params, and scoped Prisma reads/writes. Client-supplied role, actor and IDs are not authorization. Reuse status/envelope conventions; distinguish validation, auth, missing and conflict errors without leaking details. Parameterize queries, select only needed fields, and paginate or bound lists and exports. Preserve field types, nullability, pagination semantics, and side-effect expectations; review the consumers before changing a contract.
- **UI:** Prefer server reads and small client components for interactions. Keep Prisma, auth and secrets on the server; pass minimal authorized props. Provide clear loading, empty, error/retry and success states, labeled fields, keyboard/focus support and responsive layouts. Confirm success after the server accepts the action. Reuse existing components where useful. Do not use hidden controls as access control, add fake actions, or redesign unrelated screens.
- **Performance and dependencies:** Measure before optimizing. Check N+1 and repeated reads, query/relationship indexes, payload size, large lists, client JS and cleanup. Never share permission-sensitive cache across users or tenants; recheck authorization and invalidation for any private server cache. Preserve `public/sw.js` API bypass and keep private data out of PWA/offline caches. Check existing alternatives, stack compatibility and maintenance/security before adding packages. Keep a dependency patch scoped, lockfile reviewable, and environment examples free of secrets.

## 7. Security and database review

- **Authorization:** Deny by default for missing/invalid/inactive identity, unknown scope and unavailable features. Apply least privilege to each protected operation, including render, API, export, job and device entry points. Intersect mandatory scope with filters; never replace it. Review object access, role escalation, session freshness, injection, disclosure, timing/concurrency and audit. Do not add security bypasses for tests.
- **Privacy and audit:** Redact secrets, credentials, identifiers and sensitive HR content in output and logs. Audit actor, resource, ownership, outcome and time as policy requires, atomically with the business write when needed. Preserve retention; no claim of immutable history from the baseline cascade model.
- **Data:** Read relations, constraints, on-delete behavior, and migration history. Prefer compatible additive migrations with approved backfill, preserved data, verification and rollback/restore; do not rewrite applied migrations. Use transactions plus appropriate constraints or conditional writes; protect state-transition checks and their writes from concurrent changes. Preserve Decimal/explicit minor units and approved rounding. Use deterministic timezone-aware dates; never silently reinterpret history. No unapproved schema push, reset, broad seed, truncate or data transform.

## 8. Testing and definition of done

| Area | Evidence when affected |
| --- | --- |
| Functional and UI | Expected behavior, invalid and boundary input, controlled failure and recovery; include keyboard/focus, small viewport and meaningful states. |
| Auth and isolation | Synthetic allow/deny tests for relevant role, unauthenticated, inactive/stale session, absent scope, unrelated company, shared employee and direct report. Check affected read/write/render/export paths. No live probing or exploit demonstrations. |
| Database and regression | Test constraints, denied actions leave data unchanged, transaction/rollback, duplicate or concurrent decisions, historical attribution, date/money rules and affected existing flows. Only a confirmed authorized disposable target. |
| Toolchain | Use existing locked commands. Consider local no-emit TypeScript, `npm run lint`, Prisma validation, `npm run build`, and dependency review. Confirm target and side effects (including installs) before running; do not run every script by default. |

Record command/test, revision or diff, target and actual result. Distinguish baseline failures and new ones. Never delete or weaken assertions, suppress checks, or report a skipped check as passed. Do not treat a green build or UI demo as backend evidence. Classify debt: **CRITICAL** immediate security/data/major correctness risk; **HIGH** significant defect or architectural weakness; **MEDIUM** reliability/maintenance concern; **LOW** minor improvement. Cite evidence and recommend a bounded fix. Do not bundle unrelated refactors, dependency updates, migrations and features.

## 9. Reporting formats

**Preflight** before substantial work:

```text
Instruction file: Loaded — UNIHR-PLAYBOOK-v1 / Not accessible
Task scope:
Relevant modules:
Current implementation: <source evidence, HEAD, local changes>
Risks:
Proposed approach:
Approval required: Yes / No — <decision or boundary>
```

Report meaningful deviations or blockers as they arise. **Completion:**

```text
Implementation summary: <what, why, status>
Files changed:
Architecture decisions:
Security review:
Database implications:
Tests executed: <exact commands/names and results>
Verification evidence: <acceptance criteria and file refs>
Remaining issues:
Git status:
Owner action required:
```

Use one status per outcome: **IMPLEMENTED AND VERIFIED**, **IMPLEMENTED NOT FULLY VERIFIED**, **PARTIALLY IMPLEMENTED**, **UI ONLY**, **BACKEND ONLY**, **NOT IMPLEMENTED**, or **BLOCKED**. Do not repeat the playbook in replies.

## 10. Persistent loading and maintenance

Google documents workspace `AGENTS.md`, `GEMINI.md`, their `.agents/` equivalents, and immediate `.agents/rules/*.md` files (legacy `.agent/rules/` also documented). `trigger: always_on` makes this one file both the playbook and a rule; no loader is required by the documented mechanism. Rules are cumulative, not overrides. A recognized rule can inline another file with the documented include syntax; a plain file mention is only a reference. Do not edit or add a loader without approval. A plain root `ENGINEERING_PLAYBOOK.md` is not a documented discovery path. Keep rules under 24,000 bytes after includes. The 20,000-token budget across active global/always-on rules can reduce a large rule to a pointer; read the full file explicitly if needed. See Google’s [Rules](https://antigravity.google/docs/rules/) and [Customization discovery](https://antigravity.google/docs/customization-discovery/).

**Verify the installed IDE locally.** Open the actual repo root as the workspace. Confirm `.agents/rules/ENGINEERING_PLAYBOOK.md` and its always-on mode in IDE **… → Customizations → Rules** (App: **Settings → Projects → Customizations**). Inspect other active rules and reconcile conflicts with the owner. In a fresh session, ask for a read-only leave-approval preflight without supplying the marker. Expect `UNIHR-PLAYBOOK-v1`, actual `HEAD`/status, an applicable safeguard from the playbook, and no edits; repeat after context reset. This checks loading, not future compliance. The installed version was not inspected here. If discovery or content loading fails, check the workspace root, rule depth, frontmatter, any manifest exclusions, and size; provide the file explicitly and pause implementation. Request approval before adding or changing any loader.

**Example preflight on the inspected baseline** (use the live revision and status in practice):

```text
Instruction file: Loaded — UNIHR-PLAYBOOK-v1
Task scope: Inspect leave approval; no edits or database execution.
Relevant modules: src/app/(app)/leaves/approvals/, src/app/api/leaves/[id]/route.ts, src/lib/api-auth.ts.
Current implementation: main@ec4dba1, only the playbook untracked. PATCH checks live reviewer role and PENDING state, then updates in a transaction.
Risks: Shared employees, concurrent reviews, attendance date and company attribution.
Proposed approach: Compare page and API scope, transition checks, transactional effects and existing tests. Run no DB or fixture scripts.
Approval required: No for inspection; yes for policy or schema changes.
```

The repository owner approves policy and playbook changes. Propose them as a scoped review when architecture, toolchain or approved policy materially changes. Record rationale, source revision/evidence, and compatibility and loading implications. Preserve owner decisions and safeguards; remove stale facts without weakening controls. Reverify in a fresh session.
