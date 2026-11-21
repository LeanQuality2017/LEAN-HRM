# UniHR — Unified Multi-Company HRMS

**UniHR** is an enterprise multi-company Human Resource Management System (HRMS) and educational institute pipeline designed for a group of three organizations:
- **Alpha Technologies (`ALPHA`)**: IT services and software engineering enterprise.
- **Beta Solutions (`BETA`)**: Business operations and consulting enterprise.
- **SkillEdge Academy (`SKILLEDGE`)**: Training institute managing both staff and a student pipeline (courses, batches, fees, assessments, and corporate placements).

---

## 🚀 Tech Stack

- **Framework:** Next.js 16.4.5 (App Router with Turbopack, standalone output)
- **UI & Styling:** React 19, Tailwind CSS 4, shadcn/ui (Radix primitives)
- **Language:** TypeScript 5.9.3 (strict mode, zero `any`)
- **Database & ORM:** PostgreSQL 16, Prisma ORM 6.19.3
- **Authentication:** NextAuth.js v4 (credentials JWT session with live user validation)
- **Password Security:** Native salted `scrypt` hashing via `node:crypto`
- **Testing:** Vitest 5.1.1 (22 test suites, 230 tests passing)

---

## 🛠️ Quick Start

### 1. Prerequisites
- **Node.js**: `20.x` or `22.x` (LTS)
- **PostgreSQL**: `16`

### 2. Installation & Database Setup
```bash
# Clone the repository
git clone https://github.com/LeanQuality2017/LEAN-HRM.git
cd LEAN-HRM

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env to set valid DATABASE_URL, NEXTAUTH_SECRET, and BIOMETRIC_API_KEY

# Deploy database migrations and generate Prisma Client
npx prisma migrate deploy
npx prisma generate

# (Optional) Seed demo data (triple-guarded; requires explicit flag)
ALLOW_DEMO_SEED=true npm run seed
```

### 3. Run Development Server
```bash
npm run dev
# UniHR runs on port 3001 -> http://localhost:3001
```

---

## 🧪 Quality Verification Gates

UniHR maintains strict engineering quality standards. Before committing or deploying, all 5 quality checks must pass with zero errors:

```bash
# 1. Prisma schema integrity
npx prisma validate

# 2. Strict TypeScript typecheck (0 errors)
npx tsc --noEmit

# 3. Code formatting & linting (0 errors, 0 warnings)
npx eslint .

# 4. Automated regression & isolation test suite (230 tests)
npx vitest run

# 5. Production build check (37 routes)
npx next build
```

---

## 📖 Documentation & Architecture Sitemap

All project documentation is organized under the [`docs/`](./docs/README.md) directory:

- 🗺️ **[Living Project Roadmap & Plan Log](./docs/ROADMAP.md)**: **Single Source of Truth for Roadmap & Plan Changes.** Tracks current phase, completed work orders (WO-ATT-BASE..WO-ATT-REG), upcoming backlog, and a historical log of every plan change made by the Owner.
- 📘 **[Developer Handover & System Architecture](./docs/DEVELOPER-HANDOVER.md)**: Complete guide covering domain models, tenant scoping (`UserCompanyScope` vs `EmployeeCompanyAssignment`), attendance classification engine, payroll v2, and API directory.
- 📋 **[Production Readiness & Audit Report](./docs/AUDIT-REPORT.md)**: Authoritative code audit, security findings, and remediation status.
- ⚖️ **[Payroll Statutory Decisions Register](./docs/PAYROLL-DECISIONS.md)**: K1–K10 business rules (LOP divisor, OT multiplier, PF/ESI caps, PT slabs, TDS regimes).
- 🚢 **[Production Deployment Guide](./DEPLOY.md)**: Docker Compose orchestration, multi-stage containers, and production environment settings.
- 🤖 **[Agent Rules & Guardrails](./AGENTS.md)**: Mandatory rules and database safety boundaries for autonomous agents.
- 🧠 **[Developer & Behavioral Guidelines (Karpathy Framework)](./CLAUDE.md)**: Coding guidelines incorporating *Think Before Coding*, *Simplicity First*, *Surgical Changes*, and *Goal-Driven Execution*.
- 🎨 **[UI Craft Rules (Antislop)](./antislop.md)**: Design principles ensuring clean, functional, designer-crafted user interfaces.
- 📐 **[Engineering Playbook](./.agents/rules/ENGINEERING_PLAYBOOK.md)**: Stage 0–9 engineering workflow and preflight criteria.

---

## 🔒 Security & Multi-Tenancy Invariants

1. **Administrative Authority vs. Employment Link**: `UserCompanyScope` governs administrative rights; `EmployeeCompanyAssignment` governs employment. Never substitute one for the other.
2. **Server-Side Authorization Everywhere**: All route handlers enforce live sessions and tenant boundaries via `requireAuth()` and `assertCompanyInScope()`.
3. **Financial Precision**: Floating-point math is strictly forbidden for money. All financial calculations use `Prisma.Decimal`.
4. **Machine-to-Machine Security**: Biometric punch pushes (`POST /api/attendance/sync`) require constant-time API key verification (`crypto.timingSafeEqual`).

