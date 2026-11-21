# UniHR Documentation Index

Welcome to the **UniHR (LEAN-HRM)** documentation hub. This directory contains architectural specifications, business decision registers, operational handbooks, and compliance audits for the platform.

---

## 📚 Core Documentation Sitemap

| Document | Primary Audience | Description & Purpose |
| --- | --- | --- |
| **[`ROADMAP.md`](./ROADMAP.md)** | All Developers, Product Owners & Agents | **Living Roadmap & Execution Plan.** Single source of truth for phase progress (P1–P10), completed work orders, and the official Plan Change Log whenever the Owner adjusts priorities. |
| **[`DEVELOPER-HANDOVER.md`](./DEVELOPER-HANDOVER.md)** | All Engineers & Tech Leads | **Start here.** Comprehensive architecture map, multi-company model, tech stack baseline, completed roadmap (P1–P6 & Step 4), API directory, and local dev onboarding. |
| **[`AUDIT-REPORT.md`](./AUDIT-REPORT.md)** | Tech Leads & Product Owners | The authoritative production readiness and gap audit list. Contains the formal severity classifications (P0, P1, P2) and remediation roadmap. |
| **[`PAYROLL-DECISIONS.md`](./PAYROLL-DECISIONS.md)** | Payroll Ops, HR & Chartered Accountants | Business rule and statutory decisions register (K1–K10): LOP divisor, OT multiplier, PF/ESI caps, PT state slabs, TDS regimes, and settlement rules. |

---

## 🏛️ Root-Level Guidance & Agent Rules

| File | Scope | Purpose |
| --- | --- | --- |
| **[`../README.md`](../README.md)** | General | Project overview, high-level features, stack summary, and quick start guide. |
| **[`../CLAUDE.md`](../CLAUDE.md)** | Developers & AI Agents | Behavioral coding guidelines incorporating the four Karpathy-inspired principles (*Think Before Coding*, *Simplicity First*, *Surgical Changes*, *Goal-Driven Execution*). |
| **[`../AGENTS.md`](../AGENTS.md)** | Autonomous Agents | Strict project guardrails, non-negotiable constraints, database isolation gates, and tenant scoping rules. |
| **[`../antislop.md`](../antislop.md)** | UI Developers & Agents | Design and craft rules ensuring user interfaces feel designer-crafted, functional, and devoid of bloated AI boilerplate. |
| **[`../DEPLOY.md`](../DEPLOY.md)** | DevOps & SysAdmins | Production deployment guide, Docker Compose orchestration, PostgreSQL 16 containerization, and environment security. |
| **[`../.agents/rules/ENGINEERING_PLAYBOOK.md`](../.agents/rules/ENGINEERING_PLAYBOOK.md)** | AI Agents & Reviewers | Stage 0–9 mandatory engineering workflow, preflight requirements, and approval gates. |

---

## 📂 Specialized Directories

* **[`../hrms-audit-validation/`](../hrms-audit-validation/)**: 11 historical evidence registers from the baseline security and multi-tenant audit. *(Protected by project guardrails: never modify or delete).*
* **[`../.agents/skills/`](../.agents/skills/)**: Skill definitions (including `modern-web-guidance`) for agents working with modern web and accessibility standards.

