# UniHR — Developer & Agent Behavioral Guidelines (CLAUDE.md)

This document establishes engineering discipline and behavioral guidelines for LLM agents and developers working on the UniHR codebase. These guidelines bias toward caution, precision, and verification over speed.

---

## 1. Project Context & Non-Negotiables

UniHR is a unified multi-company HRMS for a group of 3 companies:
- **Commercial Companies:** Alpha Technologies, Beta Solutions
- **Training & Placement Institute:** SkillEdge Academy

### Core Stack
- **Framework:** Next.js 16 (App Router) · React 19 · TypeScript (strict)
- **Styling:** Tailwind CSS 4 · shadcn/ui (in `src/components/ui/`)
- **Database & ORM:** PostgreSQL 16 · Prisma 6
- **Auth:** NextAuth v4 (JWT credentials, role in token) · Scrypt via `src/lib/password.ts`

### Non-Negotiable Rules
1. **Administrative Scope vs. Employment Assignment:** Never substitute employment (`EmployeeCompanyAssignment`) for administrative authority (`UserCompanyScope`). `getAdministeredCompanyIds` and `getEmployedCompanyIds` represent distinct concerns.
2. **UI Stays Simple:** Functional tables + forms. No unsolicited redesigns, fancy animations, or decorative components. UI craft must comply with `antislop.md`.
3. **Server-Side Authorization Everywhere:** Every route handler and Server Component must enforce live session and role authorization (`requireAuth`, `requirePageAuth`). Route protection in `src/proxy.ts` does not replace resource authorization.
4. **Shared Constants:** Always import and use statuses and roles from `src/lib/constants.ts`. Never hardcode raw status strings.
5. **Database Safety:** `prisma db push` is strictly forbidden. `prisma/seed.ts` is destructive and triple-guarded. Automated testing must target only verified isolated test databases (`unihr_test` on port 5433).
6. **No Unapproved Git Operations:** Never commit, push, rebase, or rewrite Git history without explicit owner instructions.

---

## 2. Four Behavioral Coding Guidelines

### Guideline 1: Think Before Coding
*Don't assume. Don't hide confusion. Surface tradeoffs.*

Before implementing any change:
- **State Assumptions Explicitly:** State your interpretation of tenant scope, roles, and data boundaries before touching code. If uncertain, ask.
- **Zero Hallucination:** Base all logic strictly on verified source code, schema relations, and approved requirements. Do not invent business rules (e.g., punch-in tolerances, statutory payroll logic, or course fee structures).
- **Surface Tradeoffs:** If multiple technical approaches exist, present them with their risks and tradeoffs; do not choose silently.
- **Simpler Approaches First:** If an asked-for change can be achieved with existing helpers (`api-auth.ts`, `validation.ts`), say so.
- **Stop on Ambiguity:** If an instruction contradicts domain invariants or existing security guards, STOP and report before proceeding.

### Guideline 2: Simplicity First
*Minimum code that solves the problem. Nothing speculative.*

- **No Speculative Architecture:** Build only what is requested for the active task. No speculative database tables, unused enum values, or premature generic abstractions.
- **No Abstractions for Single-Use Code:** Write direct, readable inline logic using standard Prisma queries and Next.js conventions.
- **No Unrequested Configurability:** Do not introduce feature toggles, environment switches, or config flags unless explicitly requested.
- **Lean Route Handlers:** Follow the established pipeline:
  `requireAuth` → role check → `validateBody` (Zod) → scoped Prisma transaction/query → JSON response.
- **Functional UI:** Use simple shadcn/ui primitives. If a component can be written cleanly in 50 lines, do not build a 200-line multi-layer abstraction.

### Guideline 3: Surgical Changes
*Touch only what you must. Clean up only your own mess.*

When editing existing code:
- **Do Not "Improve" Adjacent Code:** Do not reformat untouched functions, reorder existing imports, rewrite working comments, or change styling in neighboring blocks.
- **Match Existing Style:** Conform strictly to the existing codebase patterns, naming conventions, and file organization.
- **Do Not Refactor Working Systems:** If you see unoptimized code or pre-existing technical debt while working, report it in your summary—do NOT refactor it unless it is the explicit task.
- **Orphan Cleanup:** If your modification makes imports, variables, or helper functions unused within that file, remove them. Do not delete pre-existing dead code elsewhere.
- **Traceability Test:** Every single line in your diff must trace directly to the user's explicit request.

### Guideline 4: Goal-Driven Execution
*Define success criteria. Loop until verified.*

Transform tasks into verifiable milestones:
- **Multi-Step Tasks:** State a brief step-by-step plan:
  1. `[Step]` → verify: `[check]`
  2. `[Step]` → verify: `[check]`
- **Verification Gates:**
  - **Type & Lint Check:** Run non-emitting typecheck (`npx tsc --noEmit`) and linter when appropriate.
  - **Auth & Isolation Testing:** Verify both positive paths (permitted roles) and negative paths (unauthorized roles, missing scope, and deactivated accounts receiving HTTP 401/403).
  - **State Integrity:** Verify that denied actions leave database state completely unchanged.
- **Report Clearly:** Conclude every completed task with:
  - `WHAT CHANGED`
  - `FILES TOUCHED`
  - `HOW VERIFIED`
  - `REMAINING ISSUES / RISKS`

