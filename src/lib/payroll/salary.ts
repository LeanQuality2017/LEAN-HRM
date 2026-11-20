import { Prisma } from '@prisma/client'
import { add, mul, round, sub, toDecimal, ZERO } from './money'

export interface SalaryComponentInput {
  name: string
  type: string // 'EARNING' | 'DEDUCTION'
  amount: Prisma.Decimal | string | number
  isTaxable?: boolean
  isStatutory?: boolean
}

export interface SalaryStructureInput {
  id?: string
  effectiveFrom: Date | string
  effectiveTo?: Date | string | null
  components: SalaryComponentInput[]
}

export interface SalaryRevisionInput {
  id?: string
  previousBase: Prisma.Decimal | string | number
  newBase: Prisma.Decimal | string | number
  effectiveFrom: Date | string
  reason?: string | null
}

export interface EmployeeSalaryInput {
  id: string
  baseSalary?: Prisma.Decimal | string | number
  salaryStructures?: SalaryStructureInput[]
  salaryRevisions?: SalaryRevisionInput[]
}

export interface ResolvedComponent {
  name: string
  type: 'EARNING' | 'DEDUCTION'
  amount: Prisma.Decimal
  isTaxable: boolean
  isStatutory: boolean
}

export interface ResolvedSalaryStructure {
  components: ResolvedComponent[]
  gross: Prisma.Decimal
  basic: Prisma.Decimal
  hra: Prisma.Decimal
  specialAllowance: Prisma.Decimal
  fixedDeductions: Prisma.Decimal
}

/**
 * Resolves the effective salary component breakdown for an employee in a given month/year.
 * Handles:
 * - Active structure matching the month range
 * - Revisions effective in or before the month
 * - Synthesizing standard structure (50% Basic, 30% HRA, 20% Special Allowance) if un-decomposed
 * - Zero salary handling
 */
export function resolveStructure(
  employee: EmployeeSalaryInput,
  month: number,
  year: number
): ResolvedSalaryStructure {
  const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  // Find latest salary revision effective on or before the month end
  const revisions = (employee.salaryRevisions ?? [])
    .filter((r) => new Date(r.effectiveFrom) <= monthEnd)
    .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime())
  const latestRevision = revisions[0]

  // Find structures active during the payroll month
  const structures = (employee.salaryStructures ?? [])
    .filter((s) => {
      const from = new Date(s.effectiveFrom)
      const to = s.effectiveTo ? new Date(s.effectiveTo) : null
      return from <= monthEnd && (!to || to >= monthStart)
    })
    .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime())

  const activeStructure = structures[0]

  // Check if a newer revision supersedes the active structure
  const structureEffectiveFrom = activeStructure ? new Date(activeStructure.effectiveFrom) : null
  const revisionEffectiveFrom = latestRevision ? new Date(latestRevision.effectiveFrom) : null

  let components: ResolvedComponent[] = []

  if (activeStructure && (!revisionEffectiveFrom || (structureEffectiveFrom && structureEffectiveFrom >= revisionEffectiveFrom))) {
    // Structure is up-to-date with revisions
    components = activeStructure.components.map((c) => ({
      name: c.name.trim().toUpperCase(),
      type: c.type.toUpperCase() === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING',
      amount: round(toDecimal(c.amount)),
      isTaxable: c.isTaxable !== false,
      isStatutory: c.isStatutory === true,
    }))
  } else {
    // Synthesize component breakdown from latest revision or baseSalary
    const effectiveBase = latestRevision
      ? toDecimal(latestRevision.newBase)
      : toDecimal(employee.baseSalary ?? ZERO)

    if (effectiveBase.isZero() || effectiveBase.isNegative()) {
      components = [
        { name: 'BASIC', type: 'EARNING', amount: ZERO, isTaxable: true, isStatutory: true },
        { name: 'HRA', type: 'EARNING', amount: ZERO, isTaxable: true, isStatutory: false },
        { name: 'SPECIAL_ALLOWANCE', type: 'EARNING', amount: ZERO, isTaxable: true, isStatutory: false },
      ]
    } else {
      // 50% Basic, 30% HRA, remainder to Special Allowance (avoiding rounding mismatch)
      const basic = round(mul(effectiveBase, new Prisma.Decimal('0.50')))
      const hra = round(mul(effectiveBase, new Prisma.Decimal('0.30')))
      const specialAllowance = sub(effectiveBase, add(basic, hra))

      components = [
        { name: 'BASIC', type: 'EARNING', amount: basic, isTaxable: true, isStatutory: true },
        { name: 'HRA', type: 'EARNING', amount: hra, isTaxable: true, isStatutory: false },
        { name: 'SPECIAL_ALLOWANCE', type: 'EARNING', amount: specialAllowance, isTaxable: true, isStatutory: false },
      ]
    }
  }

  // Aggregate totals
  let gross = ZERO
  let basic = ZERO
  let hra = ZERO
  let specialAllowance = ZERO
  let fixedDeductions = ZERO

  for (const comp of components) {
    if (comp.type === 'EARNING') {
      gross = add(gross, comp.amount)
      if (comp.name === 'BASIC') basic = add(basic, comp.amount)
      else if (comp.name === 'HRA') hra = add(hra, comp.amount)
      else if (comp.name === 'SPECIAL_ALLOWANCE') specialAllowance = add(specialAllowance, comp.amount)
    } else {
      fixedDeductions = add(fixedDeductions, comp.amount)
    }
  }

  return {
    components,
    gross,
    basic,
    hra,
    specialAllowance,
    fixedDeductions,
  }
}

