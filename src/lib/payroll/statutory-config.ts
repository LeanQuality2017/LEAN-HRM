import { Prisma } from '@prisma/client'

/**
 * Single Source of Truth for Statutory Rates, Thresholds, and Ceilings.
 * Every statutory rate/threshold contains:
 *   - value: The exact Decimal or numeric value
 *   - effectiveFrom: ISO date string when this statutory rate became legally effective
 *   - source: Official Act name and Gazette Notification reference
 *   - lastVerifiedOn: ISO date string when verified by legal/payroll engineering
 */

export interface StatutoryConfigItem<T = Prisma.Decimal> {
  value: T
  effectiveFrom: string // ISO date YYYY-MM-DD
  source: string // Gazette / Act section citation
  lastVerifiedOn: string // ISO date YYYY-MM-DD
}

export interface PtSlab {
  min: Prisma.Decimal
  max: Prisma.Decimal | null // null = no upper limit
  monthlyTax: Prisma.Decimal
}

export interface TaxSlab {
  min: Prisma.Decimal
  max: Prisma.Decimal | null
  rate: Prisma.Decimal
}

export const EPF_CONFIG = {
  WAGE_CEILING: {
    value: new Prisma.Decimal('15000.00'),
    effectiveFrom: '2014-09-01',
    source: 'Ministry of Labour & Employment Notification G.S.R. 608(E)',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
  EMPLOYEE_RATE: {
    value: new Prisma.Decimal('0.12'),
    effectiveFrom: '1952-11-01',
    source: "Employees' Provident Funds and Miscellaneous Provisions Act, 1952, Section 6",
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
  EMPLOYER_EPS_RATE: {
    value: new Prisma.Decimal('0.0833'),
    effectiveFrom: '1995-11-16',
    source: 'Employees Pension Scheme, 1995, Para 3',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
  EMPLOYER_EPF_RATE: {
    value: new Prisma.Decimal('0.0367'),
    effectiveFrom: '1995-11-16',
    source: "Employees' Provident Funds Scheme, 1952 (12% - 8.33%)",
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
}

export const ESI_CONFIG = {
  WAGE_CEILING: {
    value: new Prisma.Decimal('21000.00'),
    effectiveFrom: '2017-01-01',
    source: 'Gazette of India Notification S.O. 4233(E)',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
  EMPLOYEE_RATE: {
    value: new Prisma.Decimal('0.0075'),
    effectiveFrom: '2019-07-01',
    source: 'ESI (Central) Amendment Rules, 2019, Notification G.S.R. 423(E)',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
  EMPLOYER_RATE: {
    value: new Prisma.Decimal('0.0325'),
    effectiveFrom: '2019-07-01',
    source: 'ESI (Central) Amendment Rules, 2019, Notification G.S.R. 423(E)',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
}

export const PT_CONFIG: Record<
  string,
  {
    metadata: { effectiveFrom: string; source: string; lastVerifiedOn: string }
    slabs: PtSlab[]
  }
> = {
  TN: {
    metadata: {
      effectiveFrom: '2018-10-01',
      source: 'Tamil Nadu Municipal Laws (Second Amendment) Act, 2018',
      lastVerifiedOn: '2026-11-20',
    },
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
      effectiveFrom: '2023-04-01',
      source: 'Maharashtra State Tax on Professions, Trades, Callings and Employments Act, 1975, Schedule I',
      lastVerifiedOn: '2026-11-20',
    },
    slabs: [
      { min: new Prisma.Decimal('0.00'), max: new Prisma.Decimal('7500.00'), monthlyTax: new Prisma.Decimal('0.00') },
      { min: new Prisma.Decimal('7500.01'), max: new Prisma.Decimal('10000.00'), monthlyTax: new Prisma.Decimal('175.00') },
      { min: new Prisma.Decimal('10000.01'), max: null, monthlyTax: new Prisma.Decimal('200.00') },
    ],
  },
  KA: {
    metadata: {
      effectiveFrom: '2023-04-01',
      source: 'Karnataka Tax on Professions, Trades, Callings and Employments Act, 1976 (amended by Act 14 of 2023)',
      lastVerifiedOn: '2026-11-20',
    },
    slabs: [
      { min: new Prisma.Decimal('0.00'), max: new Prisma.Decimal('25000.00'), monthlyTax: new Prisma.Decimal('0.00') },
      { min: new Prisma.Decimal('25000.01'), max: null, monthlyTax: new Prisma.Decimal('200.00') },
    ],
  },
}

export const BONUS_CONFIG = {
  MIN_DAYS_WORKED: {
    value: 30,
    effectiveFrom: '1965-09-25',
    source: 'Payment of Bonus Act, 1965, Section 8',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem<number>,
  WAGE_ELIGIBILITY_CEILING: {
    value: new Prisma.Decimal('21000.00'),
    effectiveFrom: '2014-04-01',
    source: 'Payment of Bonus (Amendment) Act, 2015, Section 2(13)',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
  CALCULATION_WAGE_CEILING: {
    value: new Prisma.Decimal('7000.00'),
    effectiveFrom: '2014-04-01',
    source: 'Payment of Bonus (Amendment) Act, 2015, Section 12',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
  MIN_BONUS_RATE: {
    value: new Prisma.Decimal('0.0833'),
    effectiveFrom: '1965-09-25',
    source: 'Payment of Bonus Act, 1965, Section 10',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
  MAX_BONUS_RATE: {
    value: new Prisma.Decimal('0.20'),
    effectiveFrom: '1965-09-25',
    source: 'Payment of Bonus Act, 1965, Section 11',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
}

export const GRATUITY_CONFIG = {
  MIN_YEARS_SERVICE: {
    value: 5,
    effectiveFrom: '1972-09-16',
    source: 'Payment of Gratuity Act, 1972, Section 4(1)',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem<number>,
  DAYS_DIVISOR: {
    value: new Prisma.Decimal('26.00'),
    effectiveFrom: '1972-09-16',
    source: 'Payment of Gratuity Act, 1972, Section 4(2)',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
  DAYS_MULTIPLIER: {
    value: new Prisma.Decimal('15.00'),
    effectiveFrom: '1972-09-16',
    source: 'Payment of Gratuity Act, 1972, Section 4(2)',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
  STATUTORY_CEILING: {
    value: new Prisma.Decimal('2000000.00'),
    effectiveFrom: '2018-03-29',
    source: 'Ministry of Labour & Employment Notification S.O. 1420(E)',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,
}

export const TDS_CONFIG = {
  CESS_RATE: {
    value: new Prisma.Decimal('0.04'),
    effectiveFrom: '2018-04-01',
    source: 'Finance Act, 2018 (Section 4)',
    lastVerifiedOn: '2026-11-20',
  } as StatutoryConfigItem,

  NEW_REGIME: {
    FY2026_27: {
      standardDeduction: {
        value: new Prisma.Decimal('75000.00'),
        effectiveFrom: '2026-04-01',
        source: 'Section 16(ia) as amended by Finance Act, 2025; unchanged by Finance Act 2026',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
      slabs: [
        { min: new Prisma.Decimal('0.00'), max: new Prisma.Decimal('400000.00'), rate: new Prisma.Decimal('0.00') },
        { min: new Prisma.Decimal('400000.00'), max: new Prisma.Decimal('800000.00'), rate: new Prisma.Decimal('0.05') },
        { min: new Prisma.Decimal('800000.00'), max: new Prisma.Decimal('1200000.00'), rate: new Prisma.Decimal('0.10') },
        { min: new Prisma.Decimal('1200000.00'), max: new Prisma.Decimal('1600000.00'), rate: new Prisma.Decimal('0.15') },
        { min: new Prisma.Decimal('1600000.00'), max: new Prisma.Decimal('2000000.00'), rate: new Prisma.Decimal('0.20') },
        { min: new Prisma.Decimal('2000000.00'), max: new Prisma.Decimal('2400000.00'), rate: new Prisma.Decimal('0.25') },
        { min: new Prisma.Decimal('2400000.00'), max: null, rate: new Prisma.Decimal('0.30') },
      ] as TaxSlab[],
      rebate87AThreshold: {
        value: new Prisma.Decimal('1200000.00'),
        effectiveFrom: '2025-04-01',
        source: 'Finance Act 2025, Section 87A proviso; unchanged by Finance Act 2026',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
      rebate87AMax: {
        value: new Prisma.Decimal('60000.00'),
        effectiveFrom: '2025-04-01',
        source: 'Finance Act 2025, Section 87A proviso; unchanged by Finance Act 2026',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
    },
    FY2025_26: {
      standardDeduction: {
        value: new Prisma.Decimal('75000.00'),
        effectiveFrom: '2025-04-01',
        source: 'Section 16(ia) as amended by Finance Act, 2025',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
      slabs: [
        { min: new Prisma.Decimal('0.00'), max: new Prisma.Decimal('400000.00'), rate: new Prisma.Decimal('0.00') },
        { min: new Prisma.Decimal('400000.00'), max: new Prisma.Decimal('800000.00'), rate: new Prisma.Decimal('0.05') },
        { min: new Prisma.Decimal('800000.00'), max: new Prisma.Decimal('1200000.00'), rate: new Prisma.Decimal('0.10') },
        { min: new Prisma.Decimal('1200000.00'), max: new Prisma.Decimal('1600000.00'), rate: new Prisma.Decimal('0.15') },
        { min: new Prisma.Decimal('1600000.00'), max: new Prisma.Decimal('2000000.00'), rate: new Prisma.Decimal('0.20') },
        { min: new Prisma.Decimal('2000000.00'), max: new Prisma.Decimal('2400000.00'), rate: new Prisma.Decimal('0.25') },
        { min: new Prisma.Decimal('2400000.00'), max: null, rate: new Prisma.Decimal('0.30') },
      ] as TaxSlab[],
      rebate87AThreshold: {
        value: new Prisma.Decimal('1200000.00'),
        effectiveFrom: '2025-04-01',
        source: 'Finance Act 2025, Section 87A proviso',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
      rebate87AMax: {
        value: new Prisma.Decimal('60000.00'),
        effectiveFrom: '2025-04-01',
        source: 'Finance Act 2025, Section 87A proviso',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
    },
    FY2024_25: {
      standardDeduction: {
        value: new Prisma.Decimal('75000.00'),
        effectiveFrom: '2024-04-01',
        source: 'Section 16(ia) as amended by Finance (No. 2) Act, 2024',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
      slabs: [
        { min: new Prisma.Decimal('0.00'), max: new Prisma.Decimal('300000.00'), rate: new Prisma.Decimal('0.00') },
        { min: new Prisma.Decimal('300000.00'), max: new Prisma.Decimal('700000.00'), rate: new Prisma.Decimal('0.05') },
        { min: new Prisma.Decimal('700000.00'), max: new Prisma.Decimal('1000000.00'), rate: new Prisma.Decimal('0.10') },
        { min: new Prisma.Decimal('1000000.00'), max: new Prisma.Decimal('1200000.00'), rate: new Prisma.Decimal('0.15') },
        { min: new Prisma.Decimal('1200000.00'), max: new Prisma.Decimal('1500000.00'), rate: new Prisma.Decimal('0.20') },
        { min: new Prisma.Decimal('1500000.00'), max: null, rate: new Prisma.Decimal('0.30') },
      ] as TaxSlab[],
      rebate87AThreshold: {
        value: new Prisma.Decimal('700000.00'),
        effectiveFrom: '2023-04-01',
        source: 'Section 87A as amended by Finance Act, 2023',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
      rebate87AMax: {
        value: new Prisma.Decimal('25000.00'),
        effectiveFrom: '2023-04-01',
        source: 'Section 87A as amended by Finance Act, 2023',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
    },
    FY2023_24: {
      standardDeduction: {
        value: new Prisma.Decimal('50000.00'),
        effectiveFrom: '2023-04-01',
        source: 'Section 16(ia) as amended by Finance Act, 2023',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
      slabs: [
        { min: new Prisma.Decimal('0.00'), max: new Prisma.Decimal('300000.00'), rate: new Prisma.Decimal('0.00') },
        { min: new Prisma.Decimal('300000.00'), max: new Prisma.Decimal('600000.00'), rate: new Prisma.Decimal('0.05') },
        { min: new Prisma.Decimal('600000.00'), max: new Prisma.Decimal('900000.00'), rate: new Prisma.Decimal('0.10') },
        { min: new Prisma.Decimal('900000.00'), max: new Prisma.Decimal('1200000.00'), rate: new Prisma.Decimal('0.15') },
        { min: new Prisma.Decimal('1200000.00'), max: new Prisma.Decimal('1500000.00'), rate: new Prisma.Decimal('0.20') },
        { min: new Prisma.Decimal('1500000.00'), max: null, rate: new Prisma.Decimal('0.30') },
      ] as TaxSlab[],
      rebate87AThreshold: {
        value: new Prisma.Decimal('700000.00'),
        effectiveFrom: '2023-04-01',
        source: 'Section 87A as amended by Finance Act, 2023',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
      rebate87AMax: {
        value: new Prisma.Decimal('25000.00'),
        effectiveFrom: '2023-04-01',
        source: 'Section 87A as amended by Finance Act, 2023',
        lastVerifiedOn: '2026-11-20',
      } as StatutoryConfigItem,
    },
  },

  OLD_REGIME: {
    standardDeduction: {
      value: new Prisma.Decimal('50000.00'),
      effectiveFrom: '2019-04-01',
      source: 'Section 16(ia) as amended by Finance Act, 2019',
      lastVerifiedOn: '2026-11-20',
    } as StatutoryConfigItem,
    slabs: [
      { min: new Prisma.Decimal('0.00'), max: new Prisma.Decimal('250000.00'), rate: new Prisma.Decimal('0.00') },
      { min: new Prisma.Decimal('250000.00'), max: new Prisma.Decimal('500000.00'), rate: new Prisma.Decimal('0.05') },
      { min: new Prisma.Decimal('500000.00'), max: new Prisma.Decimal('1000000.00'), rate: new Prisma.Decimal('0.20') },
      { min: new Prisma.Decimal('1000000.00'), max: null, rate: new Prisma.Decimal('0.30') },
    ] as TaxSlab[],
    rebate87AThreshold: {
      value: new Prisma.Decimal('500000.00'),
      effectiveFrom: '2019-04-01',
      source: 'Section 87A as amended by Finance Act, 2019',
      lastVerifiedOn: '2026-11-20',
    } as StatutoryConfigItem,
    rebate87AMax: {
      value: new Prisma.Decimal('12500.00'),
      effectiveFrom: '2019-04-01',
      source: 'Section 87A as amended by Finance Act, 2019',
      lastVerifiedOn: '2026-11-20',
    } as StatutoryConfigItem,
    chapter6ACap80C: {
      value: new Prisma.Decimal('150000.00'),
      effectiveFrom: '2014-04-01',
      source: 'Finance (No. 2) Act, 2014, Section 80CCE',
      lastVerifiedOn: '2026-11-20',
    } as StatutoryConfigItem,
  },

  SURCHARGE_SLABS: {
    // Under Section 115BAC (New Regime), highest surcharge is capped at 25% for income > ₹2 Cr (Finance Act 2023 onwards)
    NEW_REGIME: [
      { threshold: new Prisma.Decimal('20000000.00'), rate: new Prisma.Decimal('0.25') },
      { threshold: new Prisma.Decimal('10000000.00'), rate: new Prisma.Decimal('0.15') },
      { threshold: new Prisma.Decimal('5000000.00'), rate: new Prisma.Decimal('0.10') },
    ],
    // Under Old Regime, surcharge above ₹5 Cr is 37%, ₹2-5 Cr is 25%, ₹1-2 Cr is 15%, ₹50L-1Cr is 10%
    OLD_REGIME: [
      { threshold: new Prisma.Decimal('50000000.00'), rate: new Prisma.Decimal('0.37') },
      { threshold: new Prisma.Decimal('20000000.00'), rate: new Prisma.Decimal('0.25') },
      { threshold: new Prisma.Decimal('10000000.00'), rate: new Prisma.Decimal('0.15') },
      { threshold: new Prisma.Decimal('5000000.00'), rate: new Prisma.Decimal('0.10') },
    ],
  },
}
