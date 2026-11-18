# Attendance Subsystem & Payroll Engine Audit

**Vulnerability Classification:** P1 (High Functional & Business Logic Defect)  
**Target:** Time Tracking, Biometric Synchronization, Payroll Generation, and Statutory Compliance  
**Key Affected Files:** `src/app/api/attendance/route.ts`, `src/app/api/attendance/sync/route.ts`, `src/app/api/payroll/route.ts`  

---

## 1. Attendance Subsystem Audit

### A. Threshold Discrepancy & Employee Inequity
UniHR supports two attendance ingestion mechanisms: web browser check-in and automated biometric device push.

```typescript
// Web Check-In Logic (src/app/api/attendance/route.ts:22)
const status = now.getHours() >= 10 ? ATTENDANCE_STATUS.LATE : ATTENDANCE_STATUS.PRESENT

// Biometric Hardware Push (src/app/api/attendance/sync/route.ts:29)
return hours * 60 + mins >= 9 * 60 + 30 // Late if >= 09:30 AM
```

#### Operational Impact
- A remote employee clocking in through the web portal at **09:55 AM** is recorded as **`PRESENT`**.
- An on-premise employee punching at the physical biometric turnstile at **09:35 AM** is recorded as **`LATE`**.
- The 30-minute threshold disparity produces discriminatory disciplinary actions and conflicts with standardized company attendance policies.

---
   
### B. Timezone Conversion & Day-Boundary Bugs

In `src/app/api/attendance/route.ts:13-15`:
```typescript
const now = new Date()
const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
today.setHours(0, 0, 0, 0)
```

#### Timezone Drift Analysis
1. `now.getTimezoneOffset()` retrieves the local timezone offset of the Node.js runtime process.
2. In production Docker containers (`node:20-alpine`), the system timezone defaults to **UTC (`offset = 0`)**, regardless of where employees or offices are located.
3. In India (IST = UTC+5:30):
   - At 10:00 AM IST, the container's UTC time is **04:30 AM**.
   - `now.getHours()` returns `4`.
   - The condition `now.getHours() >= 10` evaluates to **`false`**.
   - The web check-in will continue marking employees as `PRESENT` until 10:00 AM UTC, which is **03:30 PM IST**.
   - Consequently, employees checking in several hours late during the workday are incorrectly marked `PRESENT`.

---

### C. Overnight Shift Incompatibility

The database schema specifies:
```prisma
model Attendance {
  id         String    @id @default(cuid())
  employeeId String
  companyId  String
  date       DateTime  // Stripped to 00:00:00.000
  checkIn    DateTime?
  checkOut   DateTime?
  status     String    @default("PRESENT")
  source     String    @default("WEB")

  @@unique([employeeId, date])
}
```

#### Night Shift Failure Trace
1. An employee on a night shift clocks in at 21:00 on November 5.
   - `today` is `2026-11-05T00:00:00.000Z`.
   - Row created: `date: 2026-11-05`, `checkIn: 21:00`, `checkOut: null`.
2. The employee clocks out at 05:00 on the following morning, November 6.
   - The handler computes `today`: `2026-11-06T00:00:00.000Z`.
   - It searches for an existing record matching `[employeeId, 2026-11-06]`.
   - **No record exists for November 6.**
   - The code branch executes:
     ```typescript
     if (!existing || !existing.checkIn) {
       // Treats this checkout as a new CHECK_IN for November 6!
     }
     ```
   - The November 5 shift remains with `checkOut: null` forever, and November 6 receives an erroneous check-in at 05:00 AM.
3. **Verdict:** The attendance architecture fundamentally cannot support overnight shifts, multi-shift rosters, or shifts crossing midnight boundaries.

---

### D. Silent Attendance Tampering

In `src/app/api/attendance/route.ts:104-142`, HR personnel can manually correct attendance records:
```typescript
export async function PATCH(req: Request) {
  // Updates status, checkIn, checkOut, note...
  // ZERO logAudit() call!
}
```
An HR officer can alter attendance records, clear late flags, or convert `ABSENT` to `PRESENT` with **zero audit log entries**, introducing severe repudiation and compliance risks.

---

## 2. Payroll Engine & Financial Integrity Audit

### A. Mathematical Formulation

In `src/app/api/payroll/route.ts:99-104`:
```typescript
const baseSalary = Number(e.baseSalary)
const allowances = Math.round(baseSalary * 0.12)
const deductions = Math.round(baseSalary * 0.05)
await tx.payroll.create({
  data: {
    employeeId: e.id,
    month,
    year,
    basic: baseSalary,
    allowances,
    deductions,
    netPay: baseSalary + allowances - deductions,
    generatedById: auth.userId,
  },
})
```

$$\text{Allowances} = \text{round}(\text{baseSalary} \times 0.12)$$
$$\text{Deductions} = \text{round}(\text{baseSalary} \times 0.05)$$
$$\text{Net Pay} = \text{baseSalary} + \text{Allowances} - \text{Deductions} = 1.07 \times \text{baseSalary}$$

---

### B. Critical Financial Deficiencies

1. **Total Absence of Attendance / Leave Integration:**
   - The payroll generator queries `db.employee.findMany({ where: empWhere })`.
   - It **does not inspect** the `Attendance` table or `LeaveRequest` table.
   - An employee who logged zero attendance days, was absent for the entire month, or took unpaid leave (Loss of Pay) still receives 100% of their base salary plus 12% allowances.
2. **Hardcoded Mock Percentages:**
   - Real-world compensation involves structured components (HRA, Special Allowance, Transport Allowance, Medical).
   - Fixed 12% and 5% values represent placeholders rather than an actual payroll engine.
3. **Missing Statutory Deductions:**
   - While the UI formats currency using the Indian Rupee symbol (`₹`), none of the mandatory Indian statutory payroll deductions are implemented:
     - **Employees' Provident Fund (EPF):** 12% employee contribution on Basic + DA (capped at statutory limits).
     - **Employee State Insurance (ESI):** 0.75% deduction for wages $\le ₹21,000$.
     - **Professional Tax (PT):** State-specific slab deductions ($₹200$ standard).
     - **Tax Deducted at Source (TDS):** Income tax withholding based on annual tax regimes.
4. **No Proration for Mid-Month Joining / Exit:**
   - If an employee is onboarded on the 28th day of a 30-day month, the payroll engine awards them a full month's base salary instead of prorating for the 3 active days.
5. **No Recalculation Mechanism:**
   - Payslips are immutable once generated. If attendance corrections or base salary adjustments occur before disbursement, the system provides no recalculation or adjustment workflow.

