# UniHR Living Project Roadmap & Execution Plan

**Document Purpose:** This is the single living source of truth for the active implementation plan, completed milestones, work orders, and backlog priorities for UniHR.  
**Rule for Agents & Developers:** Whenever the Owner changes, adds, or reprioritizes any plan or directive, this document must be updated immediately to preserve alignment across all sessions.

---

## 🚦 Current Phase Overview

| Phase | Module / Area | Focus & Deliverables | Status | Tests |
| :---: | --- | --- | :---: | :---: |
| **P1** | Security & Auth | Scrypt passwords, rate limiting, atomic audit logs, Zod validation | ✅ **COMPLETED** | 25 |
| **P2** | Biometric Sync | Constant-time machine API key, row-level batch isolation, idempotent upserts | ✅ **COMPLETED** | 5 |
| **P3** | Financial Precision | Decimal money math, minor units, formula injection sanitization | ✅ **COMPLETED** | 13 |
| **P4** | Attendance & Shifts | Multi-timezone classification, shift resolver, holiday calendar, regularisation | ✅ **COMPLETED** | 35 |
| **P5** | Leave Balances | Transactional balance checks, accrual pure engine, terminal state checks | ✅ **COMPLETED** | 32 |
| **P6** | Payroll Engine v2 | Statutory PF/ESI/PT/TDS rules, payslip PDF generation, run resilience | ✅ **COMPLETED** | 72 |
| **P7** | **UI Screens (Shifts/Holidays/Reg)** | Front-end portals for shift rosters, holiday calendar, and missed punch requests | ⏳ **IN PROGRESS / NEXT** | — |
| **P8** | **Bank Payout & Statutory Returns** | 1-click HDFC/ICICI/SBI bulk payout file, PF ECR export, Form 24Q export | 📋 **BACKLOG** | — |
| **P9** | **Full & Final Settlement (F&F)** | Resignation workflow, asset clearances, leave encashment, relieving letters | 📋 **BACKLOG** | — |
| **P10** | **Production Go-Live** | Redis rate limiter, Sentry monitoring, opening production feature gates | 📋 **BACKLOG** | — |

---

## 📋 Owner Directives & Work Orders (Completed & In Progress)

| Work Order ID | Scope & Objective | Status | Completion Date | Evidence File / Route |
| --- | --- | :---: | :---: | --- |
| **WO-ATT-BASE** | Attendance compound unique key `[employeeId, companyId, date]` | ✅ Done | 2026-11-20 | `prisma/migrations/20261121_attendance_foundation` |
| **WO-ATT-ENGINE**| Pure shift classifier `classifyDay` + multi-timezone math | ✅ Done | 2026-11-20 | `src/lib/attendance/classify.ts` |
| **WO-ATT-SHIFT** | Shift resolver cascade `resolveShiftForDate` | ✅ Done | 2026-11-20 | `src/lib/attendance/resolveShift.ts` |
| **WO-ATT-SYNC**  | Biometric sync classification parity with web punch | ✅ Done | 2026-11-20 | `src/app/api/attendance/sync/route.ts` |
| **WO-ATT-ADMIN** | Admin CRUD for Shifts and Holidays with default shift lock | ✅ Done | 2026-11-21 | `src/app/api/shifts/`, `src/app/api/holidays/` |
| **WO-ATT-REG**   | Attendance Regularisation / Missed Punch Workflow (OD-A1..A6, M1 Fix) | ✅ Done | 2026-11-21 | `src/app/api/attendance/regularisation/` |
| **OD-P1-CYCLE**   | Dynamic Payroll Calendar Engine (Leap-year Feb 28/29, 26th-25th & 1st-End) | ✅ Done | 2026-11-21 | `src/lib/payroll/cycle.ts` |
| **WO-UI-SHIFTS** | HR Front-End visual screen for Shift & Holiday management | ⏳ Pending | Next | `src/app/(app)/shifts/` |
| **WO-UI-REG**    | Employee Portal request modal + Manager approval card | ⏳ Pending | Next | `src/app/(app)/attendance/` |
| **WO-PAY-BANK**  | Bank bulk transfer payout CSV (HDFC/ICICI/SBI format) | 📋 Backlog | Upcoming | `src/app/api/payroll/export/` |
| **WO-PAY-STAT**  | PF ECR text file and quarterly TDS 24Q export | 📋 Backlog | Upcoming | `src/app/api/payroll/statutory/` |

---

## 🔄 Plan Change Log

*When the Owner modifies priorities or changes a decision, record the change here:*

| Date | Changed By | Change Description & Rationale | Affected Files / Roadmap Impact |
| --- | --- | --- | --- |
| **2026-11-21** | Owner | Applied Owner Directive **WO-ATT-REG Amendment (M1 Fix)**: Full escalation chain & self-approval gates (Manager self-approval -> 403; HR approving own request -> 403 unless Super Admin; Manager request approved by HR of company). | `src/app/api/attendance/regularisation/[id]/route.ts`, `tests/app/api/attendance-regularisation.test.ts` |
| **2026-11-21** | Owner | Applied **OD-A1 Window Amendment (Ruling 10B)**: Enforced fixed 30-day window for regularisation across all companies; updated schema default and route gate. | `prisma/schema.prisma`, `src/app/api/attendance/regularisation/route.ts` |
| **2026-11-21** | Owner | Applied **OD-P1 Binding Directive (Payroll Calendar Engine)**: Zero hardcoding of 28/29/30/31 days; dynamic `date-fns` calendar engine supporting `1ST_TO_MONTH_END` and `26TH_TO_25TH` cycles with automatic leap-year February (28/29) handling across month boundaries. | `src/lib/payroll/cycle.ts`, `src/lib/payroll/index.ts`, `tests/lib/payroll/cycle.test.ts` |
| **2026-11-21** | Owner | Formally created `docs/ROADMAP.md` as the centralized living execution plan for UniHR. | `docs/ROADMAP.md`, `README.md`, `docs/README.md` |
| **2026-11-21** | Owner | Approved `WO-ATT-REG`: Implemented Missed Punch Regularisation API (OD-A1 date window, OD-A3 payroll lock, OD-A5 daily limit). Recalculation runs inside transaction with audit log. | `src/app/api/attendance/regularisation/`, `tests/app/api/attendance-regularisation.test.ts` |
| **2026-11-21** | Owner | Step 4.6 completed: Added Shift & Holiday Admin APIs with referential integrity check on delete and single default shift enforcement. | `src/app/api/shifts/`, `src/app/api/holidays/`, `tests/app/api/shifts-holidays.test.ts` |
| **2026-11-20** | Owner | Step 4.5 completed: Routed biometric sync (`POST /api/attendance/sync`) through `classifyDay()` matching web check-in. | `src/app/api/attendance/sync/route.ts` |
| **2026-11-20** | Owner | Step 4.4 completed: Added additive classification fields (`lateMinutes`, `earlyExitMinutes`, `otMinutes`, `isLop`, `shiftId`, `classifiedAt`) to `Attendance`. | `src/app/api/attendance/route.ts` |

---

## 🎯 Next Recommended Task
**`WO-UI-SHIFTS` & `WO-UI-REG`**:
- Build the visual UI pages in `src/app/(app)/` so HR and Managers can click, view, and interact with the shifts, holidays, and regularisation workflows that are already working on the backend.

