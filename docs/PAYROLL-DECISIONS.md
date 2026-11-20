# UniHR Payroll Business-Rule & Statutory Decisions Register (K1–K10)

This document formalizes the statutory, mathematical, and business policy rules for UniHR Payroll Engine v2. Every item reflects either verified statutory law or an engineering baseline. All items requiring formal sign-off by the client's Chartered Accountant (CA) or legal counsel are explicitly marked **PENDING CLIENT CA CONFIRMATION**, along with the automated test cases that must be re-run upon confirmation.

---

## Decision Matrix (K1 – K10)

### K1: Working Days Basis & LOP Divisor
- **Statutory / Business Question**: What standard divisor is used to calculate daily compensation for Loss of Pay (LOP) deductions and mid-month join/exit salary proration?
- **Available Options**:
  1. `CALENDAR`: Actual calendar days in the month (28/29 in Feb, 30 in Apr/Jun/Sep/Nov, 31 in others). Dynamic monthly divisor.
  2. `FIXED_26`: Fixed 26 working days per month (excluding 4 Sundays), reflecting the statutory day divisor under the Factories Act / Payment of Gratuity Act.
  3. `FIXED_30`: Fixed commercial 30-day month regardless of actual calendar days.
  4. `SCHEDULED_WORKING_DAYS`: Calendar days minus declared company weekly-offs and paid holidays in the given calendar month.
- **Current Code Implementation**:
  - Implemented in [src/lib/payroll/attendance.ts#L54-L70](file:///x:/LEAN-HRM/src/lib/payroll/attendance.ts#L54-L70).
  - Configurable per-company via `CompanyPayRule.workingDaysBasis` (`CALENDAR`, `FIXED_26`, `FIXED_30`) and optional override `CompanyPayRule.lopDivisor`.
  - **Fallback Default**: Defaults to `CALENDAR` (actual calendar days in the payroll month, e.g. 30 in June).
- **Status**: **PENDING CLIENT CA CONFIRMATION**
- **Tests Locking This Assumption**:
  - `tests/lib/payroll/payroll-engine.test.ts > calculates mid-month join correctly (June 16 join in 30-day month)` ([L26-L42](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L26-L42))
  - `tests/lib/payroll/payroll-engine.test.ts > calculates mid-month exit correctly (June 10 exit in 30-day month)` ([L44-L60](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L44-L60))
  - `tests/lib/payroll/payroll-engine.test.ts > calculates full LOP month correctly` ([L62-L74](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L62-L74))
  - `tests/lib/payroll/payroll-engine.test.ts > respects FIXED_26 and explicit lopDivisor` ([L76-L88](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L76-L88))
  - `tests/lib/payroll/payroll-engine.test.ts > prorates salary and deductions for employee joining on June 16` ([L341-L376](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L341-L376))

---

### K2: Overtime (OT) Multiplier & Hourly Rate Basis
- **Statutory / Business Question**: What wage base and multiplier must be applied when computing overtime pay for non-exempt staff?
- **Available Options**:
  1. `2.0x` Multiplier on Basic + DA (Mandatory for factory/workman employees under Section 59 of the Factories Act, 1948).
  2. `1.5x` to `2.0x` on Basic or Gross (Permitted under various State Shops and Commercial Establishments Acts for IT/office establishments).
  3. `1.0x` Single rate (ordinary compensation).
  4. Hourly Rate Formula: $\text{Basic} / (\text{Days} \times 8)$ vs $\text{Gross} / (\text{Days} \times 8)$.
- **Current Code Implementation**:
  - Implemented in [src/lib/payroll/engine.ts#L96-L113](file:///x:/LEAN-HRM/src/lib/payroll/engine.ts#L96-L113).
  - Uses `CompanyPayRule.otMultiplier` if configured.
  - **Fallback Default**: Defaults to `1.50` (1.5x). If `employee.hourlyRate` is null, derives standard hourly rate as $\text{Basic} / (\text{TotalMonthDays} \times 8\text{ hours})$.
- **Status**: **PENDING CLIENT CA CONFIRMATION**
- **Tests Locking This Assumption**:
  - `tests/lib/payroll/payroll-engine.test.ts > calculates OT with explicit hourly rate and multiplier` ([L223-L242](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L223-L242))
  - `tests/lib/payroll/payroll-engine.test.ts > calculates OT with derived hourly rate when hourlyRate is null` ([L244-L264](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L244-L264))

---

### K3: PF Wage Ceiling & Proration on Mid-Month Join
- **Statutory / Business Question**: When an employee joins mid-month, should the statutory ₹15,000 Provident Fund wage ceiling under Para 26A(2) of the EPF Scheme be prorated by days worked, or applied to the prorated basic wage?
- **Available Options**:
  1. Prorate the wage ceiling: $\text{Effective Ceiling} = ₹15,000 \times (\text{PaidDays} / \text{MonthDays})$.
  2. Cap on prorated earnings: $\min(\text{Prorated Basic}, ₹15,000)$.
  3. Uncapped voluntary PF on full actual basic earnings.
- **Current Code Implementation**:
  - Implemented in [src/lib/payroll/engine.ts#L86](file:///x:/LEAN-HRM/src/lib/payroll/engine.ts#L86) and [src/lib/payroll/statutory.ts#L10-L18](file:///x:/LEAN-HRM/src/lib/payroll/statutory.ts#L10-L18).
  - Prorates Basic salary first by $(\text{PaidDays} / \text{MonthDays})$, then caps at `EPF_CONFIG.WAGE_CEILING` (₹15,000) if `pfCeiling` is true.
- **Status**: **PENDING CLIENT CA CONFIRMATION**
- **Tests Locking This Assumption**:
  - `tests/lib/payroll/payroll-engine.test.ts > computes PF wages capped at ₹15,000 ceiling when pfCeiling is true` ([L92-L104](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L92-L104))
  - `tests/lib/payroll/payroll-engine.test.ts > computes PF wages uncapped when pfCeiling is false` ([L106-L109](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L106-L109))
  - `tests/lib/payroll/payroll-engine.test.ts > prorates salary and deductions for employee joining on June 16` ([L341-L376](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L341-L376))

---

### K4: ESI Wage Ceiling & 6-Month Contribution Period Continuation
- **Statutory / Business Question**: If an employee's monthly gross wage exceeds the statutory ₹21,000 ESI threshold due to an increment or mid-period overtime, does ESI deduction continue until the end of the ongoing statutory contribution period?
- **Available Options**:
  1. Contribution Period Continuation Rule: Under Rule 50 of the Employees' State Insurance (Central) Rules, 1950, if an employee's wage crosses ₹21,000 after the start of a contribution period (April 1 to Sept 30, or Oct 1 to March 31), deductions **MUST continue** until the end of that contribution period.
  2. Discrete Monthly Evaluation: ESI is evaluated strictly month-by-month; any month where gross exceeds ₹21,000 incurs zero deduction.
- **Current Code Implementation**:
  - Implemented in [src/lib/payroll/statutory.ts#L46-L69](file:///x:/LEAN-HRM/src/lib/payroll/statutory.ts#L46-L69).
  - Evaluates monthly gross in isolation against `ESI_CONFIG.WAGE_CEILING` (₹21,000). If gross > ₹21,000, returns ₹0.00.
- **Status**: **PENDING CLIENT CA CONFIRMATION**
- **Tests Locking This Assumption**:
  - `tests/lib/payroll/payroll-engine.test.ts > applies ESI at or below ₹21,000 gross monthly wage boundary` ([L128-L140](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L128-L140))
  - `tests/lib/payroll/payroll-engine.test.ts > exempts ESI immediately above ₹21,000 gross boundary` ([L142-L152](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L142-L152))

---

### K5: Professional Tax State Slabs & February Apportionment
- **Statutory / Business Question**: How should state-specific annual PT statutory caps (e.g. Maharashtra ₹2,500/year requiring ₹300 in February instead of ₹200; Tamil Nadu half-yearly ₹1,250 cap) be scheduled across monthly payroll runs?
- **Available Options**:
  1. Exact Calendar Schedulers: Deduct ₹200 Mar–Jan and ₹300 in February for Maharashtra.
  2. Uniform Monthly Apportionment: Deduct uniform ₹208.33/month for Tamil Nadu (₹1,250 / 6 months).
  3. Half-Yearly Lump-Sum Deduction: Deduct once in September and once in March.
- **Current Code Implementation**:
  - Implemented in [src/lib/payroll/statutory-config.ts](file:///x:/LEAN-HRM/src/lib/payroll/statutory-config.ts) and [src/lib/payroll/statutory.ts#L74-L95](file:///x:/LEAN-HRM/src/lib/payroll/statutory.ts#L74-L95).
  - Deducts monthly based on progressive slabs. For Tamil Nadu, applies ₹208.33/mo for the highest bracket. For Maharashtra, applies ₹200.00/mo flat without the February ₹300 spike.
- **Status**: **PENDING CLIENT CA CONFIRMATION**
- **Tests Locking This Assumption**:
  - `tests/lib/payroll/payroll-engine.test.ts > evaluates Tamil Nadu (TN) monthly apportioned slabs` ([L162-L169](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L162-L169))
  - `tests/lib/payroll/payroll-engine.test.ts > evaluates Maharashtra (MH) monthly slabs` ([L171-L176](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L171-L176))
  - `tests/lib/payroll/payroll-engine.test.ts > evaluates Karnataka (KA) 2023 revised slabs` ([L178-L183](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L178-L183))

---

### K6: Missing-Attendance Policy
- **Statutory / Business Question**: If an active employee has zero recorded punches or attendance records for a payroll period, what is the default payroll processing action?
- **Available Options**:
  1. Default Full Pay: Assume 100% attendance unless explicit absence/leave is recorded.
  2. Default Full LOP: Treat unpunched days as unauthorized absence (LOP = total working days).
  3. Generation Hard Block: Reject payroll generation and force HR/Manager attendance regularisation.
- **Current Code Implementation**:
  - Implemented in [src/app/api/payroll/route.ts#L628-L633](file:///x:/LEAN-HRM/src/app/api/payroll/route.ts#L628-L633).
  - Defaults to `lopDays = 0` and `otHours = 0`, generating 100% full pay if no attendance records exist.
- **Status**: **PENDING CLIENT CA CONFIRMATION**
- **Tests Locking This Assumption**:
  - `tests/lib/payroll/payroll-engine.test.ts > handles employee with zero base salary safely` ([L268-L286](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L268-L286))
  - `tests/lib/payroll/payroll-engine.test.ts > calculates mid-month join correctly` ([L26-L42](file:///x:/LEAN-HRM/tests/lib/payroll/payroll-engine.test.ts#L26-L42))

---

### K7: Leave Encashment Divisor & Eligibility on Separation
- **Statutory / Business Question**: For Full & Final (F&F) settlement, what daily wage divisor and compensation components are used to calculate earned leave encashment?
- **Available Options**:
  1. $\text{Basic} / 30 \times \text{Leave Days}$ (standard commercial divisor).
  2. $\text{Basic} / 26 \times \text{Leave Days}$ (statutory working days divisor).
  3. $\text{Gross} / 30 \times \text{Leave Days}$ (total earnings divisor).
  4. Statutory limit / policy cap on encashable days (e.g. max 30, 45, or 60 days).
- **Current Code Implementation**:
  - Implemented in [src/lib/payroll/settlement.ts#L173-L181](file:///x:/LEAN-HRM/src/lib/payroll/settlement.ts#L173-L181).
  - Computes $\text{Leave Days} \times (\text{Basic} / \text{leaveDivisor})$, with `leaveDivisor` defaulting to 30.
- **Status**: **PENDING CLIENT CA CONFIRMATION**
- **Tests Locking This Assumption**:
  - `tests/lib/payroll/settlement.test.ts > I10: Full & Final: Guarantees Net-never-negative invariant and routes excess deductions to recoverableBalance` ([L146-L193](file:///x:/LEAN-HRM/tests/lib/payroll/settlement.test.ts#L146-L193))

---

### K8: Gratuity Part-Year Service Rounding & Continuous Service Rule
- **Statutory / Business Question**: Under Section 4(2) of the Payment of Gratuity Act, 1972, how should part-year tenure be rounded, and how is the 5-year eligibility threshold enforced?
- **Available Options**:
  1. $> 6$ Months Rounds Up: Completed years + if partial months $> 6$ (i.e. $\ge 7$ months), round up to 1 year; if $\le 6$ months, discard.
  2. $\ge 6$ Months Rounds Up: Partial service of 6 months or more rounds up to 1 full year.
  3. Completed Years Only: Discard partial months entirely.
  4. 240-Day Rule for 5th Year: Madras High Court / Supreme Court precedents holding 4 years and 240 days satisfies the 5-year requirement in non-continuous establishments.
- **Current Code Implementation**:
  - Implemented in [src/lib/payroll/settlement.ts#L119-L141](file:///x:/LEAN-HRM/src/lib/payroll/settlement.ts#L119-L141).
  - Requires `tenureYears >= 5` (unless death/disablement). For tenure rounding, `tenureMonths > 6` rounds up to $+1$ year; $\le 6$ months is discarded.
- **Status**: **PENDING CLIENT CA CONFIRMATION**
- **Tests Locking This Assumption**:
  - `tests/lib/payroll/settlement.test.ts > I6: Gratuity: Ineligible if tenure is less than 5 completed continuous years` ([L80-L91](file:///x:/LEAN-HRM/tests/lib/payroll/settlement.test.ts#L80-L91))
  - `tests/lib/payroll/settlement.test.ts > I7: Gratuity: Computes correct amount using 15/26 formula for service >= 5 years` ([L93-L106](file:///x:/LEAN-HRM/tests/lib/payroll/settlement.test.ts#L93-L106))
  - `tests/lib/payroll/settlement.test.ts > I8: Gratuity: Part-year tenure > 6 months rounds up to full year; <= 6 months drops` ([L108-L126](file:///x:/LEAN-HRM/tests/lib/payroll/settlement.test.ts#L108-L126))
  - `tests/lib/payroll/settlement.test.ts > I9: Gratuity: Caps total gratuity payment at statutory limit of ₹20,00,000` ([L128-L144](file:///x:/LEAN-HRM/tests/lib/payroll/settlement.test.ts#L128-L144))

---

### K9: Statutory Bonus Calculation Base & Accounting Year
- **Statutory / Business Question**: For employees earning Basic + DA between ₹7,000 and ₹21,000, should bonus be computed on the statutory ceiling of ₹7,000/month or on the state-specific scheduled minimum wage?
- **Available Options**:
  1. Statutory Ceiling ₹7,000/month: Under Section 12 of Payment of Bonus (Amendment) Act, 2015.
  2. State Scheduled Minimum Wage: Higher of ₹7,000 or the minimum wage for the scheduled employment notified by the appropriate Government (under Section 12 proviso).
- **Current Code Implementation**:
  - Implemented in [src/lib/payroll/settlement.ts#L71-L82](file:///x:/LEAN-HRM/src/lib/payroll/settlement.ts#L71-L82).
  - Defaults calculation ceiling to ₹7,000.00 unless an explicit `minimumWage` is provided, using $\max(₹7000, \text{minimumWage})$.
- **Status**: **PENDING CLIENT CA CONFIRMATION**
- **Tests Locking This Assumption**:
  - `tests/lib/payroll/settlement.test.ts > I1: Statutory Bonus: Ineligible if days worked in accounting year is less than 30` ([L8-L17](file:///x:/LEAN-HRM/tests/lib/payroll/settlement.test.ts#L8-L17))
  - `tests/lib/payroll/settlement.test.ts > I2: Statutory Bonus: Ineligible if monthly basic salary exceeds ₹21,000 ceiling` ([L19-L29](file:///x:/LEAN-HRM/tests/lib/payroll/settlement.test.ts#L19-L29))
  - `tests/lib/payroll/settlement.test.ts > I3: Statutory Bonus: Computes minimum statutory bonus 8.33% on ₹7,000 calculation ceiling` ([L31-L45](file:///x:/LEAN-HRM/tests/lib/payroll/settlement.test.ts#L31-L45))
  - `tests/lib/payroll/settlement.test.ts > I4: Statutory Bonus: Computes maximum statutory bonus 20.00% on calculation ceiling` ([L47-L58](file:///x:/LEAN-HRM/tests/lib/payroll/settlement.test.ts#L47-L58))
  - `tests/lib/payroll/settlement.test.ts > I5: Statutory Bonus: Clamps rate below 8.33% up to minimum and above 20% down to maximum` ([L60-L78](file:///x:/LEAN-HRM/tests/lib/payroll/settlement.test.ts#L60-L78))

---

### K10: TDS Slab Year, Standard Deduction & Investment Proof Cutoff
- **Statutory / Business Question**: Which financial year's Finance Act provisions should apply as default for current payroll runs (FY 2024-25 vs FY 2023-24), and how should unverified investment declarations be phased into tax deductions?
- **Available Options**:
  1. Finance (No. 2) Act, 2024: Standard deduction ₹75,000; revised slabs (3L–7L @ 5%, 7L–10L @ 10%, 10L–12L @ 15%, 12L–15L @ 20%, >15L @ 30%).
  2. Finance Act, 2023: Standard deduction ₹50,000; slabs (3L–6L @ 5%, 6L–9L @ 10%, 9L–12L @ 15%, 12L–15L @ 20%, >15L @ 30%).
  3. Proof Cutoff Policy: Deduct tax based on declarations from April to December; require verified proofs in January; revoke unverified deductions in February/March.
- **Current Code Implementation**:
  - Implemented in [src/lib/payroll/statutory-config.ts](file:///x:/LEAN-HRM/src/lib/payroll/statutory-config.ts) and [src/lib/payroll/tds.ts](file:///x:/LEAN-HRM/src/lib/payroll/tds.ts).
  - Defaults to `FY2024_25` (Finance (No. 2) Act 2024: ₹75,000 std deduction, revised slabs, Section 87A marginal relief), while also supporting `FY2023_24` as a parameter.
- **Status**: **PENDING CLIENT CA CONFIRMATION**
- **Tests Locking This Assumption**:
  - `tests/lib/payroll/tds.test.ts > H2: New Regime: Income below basic exemption threshold results in zero tax` ([L23-L38](file:///x:/LEAN-HRM/tests/lib/payroll/tds.test.ts#L23-L38))
  - `tests/lib/payroll/tds.test.ts > H3: New Regime: Taxable income <= ₹7,00,000 receives 100% Section 87A rebate resulting in zero tax` ([L40-L57](file:///x:/LEAN-HRM/tests/lib/payroll/tds.test.ts#L40-L57))
  - `tests/lib/payroll/tds.test.ts > H4: New Regime: Marginal Relief u/s 87A proviso caps tax at excess income over ₹7,00,000` ([L59-L81](file:///x:/LEAN-HRM/tests/lib/payroll/tds.test.ts#L59-L81))
  - `tests/lib/payroll/tds.test.ts > H5: New Regime: Computes progressive slab tax correctly for high income above marginal relief with 4% cess` ([L83-L106](file:///x:/LEAN-HRM/tests/lib/payroll/tds.test.ts#L83-L106))
  - `tests/lib/payroll/tds.test.ts > H6: Old Regime: Taxable income <= ₹5,00,000 receives 100% Section 87A rebate resulting in zero tax` ([L108-L124](file:///x:/LEAN-HRM/tests/lib/payroll/tds.test.ts#L108-L124))
  - `tests/lib/payroll/tds.test.ts > H7: Old Regime: Deducts Section 80C and 80D from gross salary` ([L126-L142](file:///x:/LEAN-HRM/tests/lib/payroll/tds.test.ts#L126-L142))
  - `tests/lib/payroll/tds.test.ts > H8: Old Regime: Computes slab tax correctly above ₹5,00,000 with 4% cess` ([L144-L162](file:///x:/LEAN-HRM/tests/lib/payroll/tds.test.ts#L144-L162))
  - `tests/lib/payroll/tds.test.ts > H9: Spreads annual tax liability evenly across remaining months in financial year` ([L164-L185](file:///x:/LEAN-HRM/tests/lib/payroll/tds.test.ts#L164-L185))
  - `tests/lib/payroll/tds.test.ts > H10: Correctly re-spreads remaining tax liability after mid-year deductions or revisions` ([L187-L203](file:///x:/LEAN-HRM/tests/lib/payroll/tds.test.ts#L187-L203))

