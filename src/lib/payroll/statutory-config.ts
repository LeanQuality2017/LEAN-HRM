import { Prisma } from '@prisma/client'

/**
 * Statutory Configurations & Schedules for Indian Payroll.
 *
 * Mandatory rule: All rates, thresholds, and ceilings MUST be documented
 * with citations to official Gazette Notifications / Acts and effectiveFrom dates.
 * Magic numbers must NEVER be inlined into business logic.
 */

export interface StatutoryRuleMetadata {
  act: string
  notificationRef: string
  effectiveFrom: string // ISO date YYYY-MM-DD
  description: string
}

export interface PtSlab {
  min: Prisma.Decimal
  max: Prisma.Decimal | null // null = no upper limit
  monthlyTax: Prisma.Decimal
}

export const EPF_CONFIG = {
  metadata: {
    act: "Employees' Provident Funds and Miscellaneous Provisions Act, 1952",
    notificationRef: 'Ministry of Labour & Employment Notification G.S.R. 608(E)',
    effectiveFrom: '2014-09-01',
    description:
      'Statutory PF wage ceiling raised to ₹15,000/month; employee PF 12%, employer EPS 8.33%, employer EPF 3.67%.',
  } as StatutoryRuleMetadata,
  /**
   * Statutory wage ceiling for mandatory PF contribution calculations.
   * Under Para 26A(2) of the EPF Scheme, employees joining with basic > 15,000 can be capped at 15,000.
   */
  WAGE_CEILING: new Prisma.Decimal('15000.00'),
  EMPLOYEE_RATE: new Prisma.Decimal('0.12'), // 12%
  EMPLOYER_EPS_RATE: new Prisma.Decimal('0.0833'), // 8.33% capped at wage ceiling
  EMPLOYER_EPF_RATE: new Prisma.Decimal('0.0367'), // 3.67% (12% - 8.33%)
}

export const ESI_CONFIG = {
  metadata: {
    act: "Employees' State Insurance Act, 1948",
    notificationRef: 'Gazette of India Notification S.O. 4233(E) & G.S.R. 423(E)',
    effectiveFrom: '2019-07-01',
    description:
      'Gross wage threshold ₹21,000/month. Contribution rates reduced to Employee 0.75% and Employer 3.25% effective 1 July 2019.',
  } as StatutoryRuleMetadata,
  /**
   * Gross monthly wage ceiling below or equal to which ESI is applicable.
   */
  WAGE_CEILING: new Prisma.Decimal('21000.00'),
  EMPLOYEE_RATE: new Prisma.Decimal('0.0075'), // 0.75%
  EMPLOYER_RATE: new Prisma.Decimal('0.0325'), // 3.25%
}

export const PT_CONFIG: Record<string, { metadata: StatutoryRuleMetadata; slabs: PtSlab[] }> = {
  TN: {
    metadata: {
      act: 'Tamil Nadu Municipal Laws (Second Amendment) Act, 2018',
      notificationRef: 'Tamil Nadu Govt Gazette Notification / Chennai Municipal Corporation Slabs',
      effectiveFrom: '2018-10-01',
      description:
        'Professional Tax levied half-yearly, apportioned to monthly payroll deductions.',
    },
    // Tamil Nadu monthly apportioned slabs (based on half-yearly gross slabs):
    // Up to ₹21,000/half-year (<= ₹3,500/mo): Nil
    // ₹21,001 - ₹30,000/half-year (₹3,501 - ₹5,000/mo): ₹20.00/mo (₹120/half-year)
    // ₹30,001 - ₹45,000/half-year (₹5,001 - ₹7,500/mo): ₹40.00/mo (₹240/half-year)
    // ₹45,001 - ₹60,000/half-year (₹7,501 - ₹10,000/mo): ₹80.00/mo (₹480/half-year)
    // ₹60,001 - ₹75,000/half-year (₹10,001 - ₹12,500/mo): ₹125.00/mo (₹750/half-year)
    // Above ₹75,000/half-year (> ₹12,500/mo): ₹208.33/mo (capped at ₹1,250/half-year; ₹208/mo standard)
    slabs: [
      { min: new Prisma.Decimal('0.00'), max: new Prisma.Decimal('3500.00'), monthlyTax: new Prisma.Decimal('0.00') },
      { min: new Prisma.Decimal('3500.01'), max: new Prisma.Decimal('5000.00'), monthlyTax: new Prisma.Decimal('20.00') },
      { min: new Prisma.Decimal('5000.01'), max: new Prisma.Decimal('7500.00'), monthlyTax: new Prisma.Decimal('40.00') },
      { min: new Prisma.Decimal('7500.01'), max: new Prisma.Decimal('10000.00'), monthlyTax: new Prisma.Decimal('80.00') },
      { min: new Prisma.Decimal('10000.01'), max: new Prisma.Decimal('12500.00'), monthlyTax: new Prisma.Decimal('125.00') },
      { min: new Prisma.Decimal('12500.01'), max: null, monthlyTax: new Prisma.Decimal('208.33') },
    ],
  },
  MH: {
    metadata: {
      act: 'Maharashtra State Tax on Professions, Trades, Callings and Employments Act, 1975',
      notificationRef: 'Maharashtra Act No. VII of 1975, Schedule I',
      effectiveFrom: '2023-04-01',
      description:
        'Monthly professional tax: <= ₹7,500: Nil; ₹7,501 to ₹10,000: ₹175; > ₹10,000: ₹200 (₹300 in February).',
    },
    slabs: [
      { min: new Prisma.Decimal('0.00'), max: new Prisma.Decimal('7500.00'), monthlyTax: new Prisma.Decimal('0.00') },
      { min: new Prisma.Decimal('7500.01'), max: new Prisma.Decimal('10000.00'), monthlyTax: new Prisma.Decimal('175.00') },
      { min: new Prisma.Decimal('10000.01'), max: null, monthlyTax: new Prisma.Decimal('200.00') },
    ],
  },
  KA: {
    metadata: {
      act: 'Karnataka Tax on Professions, Trades, Callings and Employments Act, 1976',
      notificationRef: 'Karnataka Act No. 14 of 2023 (effective 01-Apr-2023)',
      effectiveFrom: '2023-04-01',
      description:
        'Threshold exemption limit raised from ₹15,000 to ₹25,000 per month. Above ₹25,000 is ₹200/month.',
    },
    slabs: [
      { min: new Prisma.Decimal('0.00'), max: new Prisma.Decimal('25000.00'), monthlyTax: new Prisma.Decimal('0.00') },
      { min: new Prisma.Decimal('25000.01'), max: null, monthlyTax: new Prisma.Decimal('200.00') },
    ],
  },
}

