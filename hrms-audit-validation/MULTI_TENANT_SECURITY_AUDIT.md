# Multi-Tenant Security & Tenant Isolation Audit

**Vulnerability Classification:** P0 (Critical Architectural Defect)  
**Target:** UniHR Multi-Company Separation Model  
**Key Affected Areas:** React Server Components (`src/app/(app)/*`), Direct Prisma Invocations, and Multi-Company Scoping Helpers  

---

## 1. Multi-Tenant Architectural Model Overview

UniHR implements a shared-database, shared-schema multi-tenant architecture designed to host three distinct corporate entities:
1. `Alpha Technologies` (Commercial Corporate)
2. `Beta Solutions` (Commercial Corporate)
3. `SkillEdge Academy` (Educational / Training Institute)

Tenants are logically isolated via foreign keys referencing `Company.id`. Users are mapped to companies via:
- `EmployeeCompanyAssignment` (for staff members, supporting multi-company shared roles)
- `UserCompanyScope` (for administrative and HR users)

### Architectural Gating Strategy
- **API Boundary:** Handled by `src/lib/api-auth.ts` using `getScopedCompanyIds(auth)` and `assertCompanyInScope(companyId, scopedIds)`.
- **Edge Boundary:** Handled by `src/proxy.ts` and `src/lib/page-guard.ts` via URL pathname role gating.
- **SSR Page Boundary:** Individual React Server Component pages (`page.tsx`) execute server-side Prisma queries directly.

---

## 2. Critical Defect: Cross-Tenant Data Exposure in Server Components

The primary vulnerability of the system is a **systemic failure to apply tenant scoping inside React Server Component pages**. While API routes were hardened with `getScopedCompanyIds()`, the server-rendered pages query the Prisma singleton `db` directly, omitting company filters for `COMPANY_ADMIN` and `HR` roles.

### Summary of Exposed SSR Pages

| Page Route | Source File | Line Numbers | Exposed Information |
|---|---|---|---|
| `/employees` | `src/app/(app)/employees/page.tsx` | Lines 18–37 | **Full Employee Directory of other tenants**: Names, email addresses, phone numbers, employee codes, designations, and **unmasked base salaries**. |
| `/payroll` | `src/app/(app)/payroll/page.tsx` | Lines 28–50 | **All Payslips of other tenants**: Total company payroll aggregates, monthly basic pay, allowances, deductions, net salary, and payment statuses. |
| `/attendance` | `src/app/(app)/attendance/page.tsx` | Lines 42–60 | **All Attendance Punch Records of other tenants**: Check-in and check-out timestamps, late statuses, biometric sources, and dates. |
| `/leaves/approvals` | `src/app/(app)/leaves/approvals/page.tsx` | Lines 22–37 | **All Pending Leaves across companies**: Employee identities, leave dates, leave types, and confidential leave reasons. |
| `/work-reports` | `src/app/(app)/work-reports/page.tsx` | Lines 27–49 | **Confidential Daily Work Reports**: Daily task logs, hours worked, blockers, and manager review comments across other companies. |
| `/recruitment` | `src/app/(app)/recruitment/page.tsx` | Lines 24–35 | **All Job Openings & Candidate Resumes**: If an admin has no employee record, they see all vacancies and candidate applications across companies. |
| `/performance` | `src/app/(app)/performance/page.tsx` | Lines 21–35 | **All Performance Reviews & KPIs**: Appraisals, manager ratings, and quantitative employee performance indicators across all tenants. |

---

## 3. Deep-Dive Code Evidence

### A. Employees Directory (`/employees`)
```typescript
// src/app/(app)/employees/page.tsx:18-29
const companies = await db.company.findMany({ select: { id: true, name: true, code: true }, orderBy: { createdAt: 'asc' } })
const employees = await db.employee.findMany({
  where: q
    ? {
        OR: [
          { employeeCode: { contains: q, mode: 'insensitive' } },
          { designation: { contains: q, mode: 'insensitive' } },
          { user: { name: { contains: q, mode: 'insensitive' } } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
        ],
      }
    : {},
  orderBy: { employeeCode: 'asc' },
  include: {
    user: { select: { name: true, email: true, phone: true, role: true, isActive: true } },
    assignments: { include: { company: { select: { code: true } } }, orderBy: { isPrimary: 'desc' } },
    manager: { select: { employeeCode: true, user: { select: { name: true } } } },
    _count: { select: { directReports: true } },
  },
})
```
- **Vulnerability:** When `q` is absent, `where` is `{}`.
- **Impact:** An HR officer from Alpha Technologies sees all employees from Beta Solutions and SkillEdge Academy, including their salaries (`fmtMoney(Number(e.baseSalary))`).

### B. Payroll Dashboard (`/payroll`)
```typescript
// src/app/(app)/payroll/page.tsx:28-34
const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'].includes(role)
...
const where = isAdmin ? {} : employeeId ? { employeeId } : { id: '__none__' }

const [totalCount, totalsAgg, payslips] = await Promise.all([
  db.payroll.count({ where }),
  db.payroll.groupBy({
    by: ['status'],
    where,
    _sum: { netPay: true },
  }),
  db.payroll.findMany({ where, ... }),
])
```
- **Vulnerability:** For `COMPANY_ADMIN` and `HR`, `where` evaluates to `{}`.
- **Impact:** Complete exposure of corporate payroll totals and individual payslips across rival tenant entities.

### C. Attendance Roster (`/attendance`)
```typescript
// src/app/(app)/attendance/page.tsx:42-48
const where: Record<string, unknown> = {}
if (isAdmin) {
  if (role === 'MANAGER' && employeeId) where.employee = { managerId: employeeId }
  if (sp.companyId) where.companyId = sp.companyId
} else if (employeeId) {
  where.employeeId = employeeId
}
```
- **Vulnerability:** If `sp.companyId` is not supplied, `where` is `{}`. Furthermore, if an HR user manually adds `?companyId=<other-company-id>`, no check prevents them from querying other companies' attendance logs.

### D. Daily Work Reports (`/work-reports`)
```typescript
// src/app/(app)/work-reports/page.tsx:27-33
const where: Record<string, unknown> = {}
if (scope === 'mine') {
  if (employeeId) where.employeeId = employeeId
} else {
  if (role === 'MANAGER' && employeeId) where.employee = { managerId: employeeId }
  if (sp.companyId) where.companyId = sp.companyId
}
```
- **Vulnerability:** In team view (`scope=team`), `where` defaults to `{}` for HR and Company Admin, exposing internal project deliverables and blockers across companies.

---

## 4. Tenant Isolation in API Routes vs SSR Pages

| Layer / Mechanism | Implementation Quality | Security Status | Notes |
|---|---|---|---|
| **API Route Handlers** (`src/app/api/*`) | `requireAuth()`, `getScopedCompanyIds()`, `assertCompanyInScope()` | **Adequate** | Mutations and fetches properly enforce scoped company IDs. Cross-tenant writes return 403 Forbidden. |
| **Server-Rendered Pages** (`src/app/(app)/*`) | Unfiltered Prisma queries | **Severely Flawed** | 5 core pages have zero tenant filtering, causing extensive horizontal privilege escalation. |
| **CSV Exports** (`src/app/api/export/*`) | Scoped Prisma queries | **Adequate** | Enforces company scope on attendance, payroll, and institute data. |
| **Audit Log Page** (`src/app/(app)/audit/page.tsx`) | `getScopedCompanyIds()` applied | **Good** | The only page where SSR tenant scoping was implemented correctly. |

---

## 5. Architectural Root Cause & Universal Remediation

### Root Cause
Development relied on Next.js middleware (`src/proxy.ts`) to enforce access control. However, middleware only evaluates URL pathnames against user roles (`checkPageAccess(role, pathname)`). It cannot determine tenant ownership of the requested dataset. The developers implemented tenant guards in `api-auth.ts` for API endpoints, but treated React Server Components as "safe internal code", querying the database without tenant parameters.

### Universal Remediation Pattern
Every React Server Component page must resolve tenant scope before executing database queries:

```typescript
// Required Server Component Pattern:
const session = await getServerSession(authOptions)
if (!session?.user?.id) redirect('/login')

const scopedCompanyIds = await getScopedCompanyIds({
  role: session.user.role,
  userId: session.user.id,
  employeeId: session.user.employeeId,
})

const tenantFilter = scopedCompanyIds
  ? { companyId: { in: scopedCompanyIds } }
  : {} // SUPER_ADMIN sees all
```

