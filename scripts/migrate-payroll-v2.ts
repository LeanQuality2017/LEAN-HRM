/**
 * UniHR Payroll Engine v2 - Data Model Backfill Script
 *
 * Creates default CompanyPayRule for companies and initializes SalaryStructure + StatutoryProfile
 * from existing Employee.baseSalary records.
 *
 * Flags:
 *   --dry-run    Runs in simulation mode without writing mutations to the database (default: true if flag passed)
 *
 * Usage:
 *   npx tsx scripts/migrate-payroll-v2.ts --dry-run
 *   npx tsx scripts/migrate-payroll-v2.ts
 */

import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  console.log('='.repeat(70))
  console.log(`UniHR Payroll Engine v2 Data Backfill [MODE: ${isDryRun ? 'DRY-RUN (SIMULATION)' : 'LIVE EXECUTION'}]`)
  console.log('='.repeat(70))

  let companiesEvaluated = 0
  let companyPayRulesNeeded = 0
  let companyPayRulesSkipped = 0

  let employeesEvaluated = 0
  let salaryStructuresNeeded = 0
  let salaryStructuresSkipped = 0
  let statutoryProfilesNeeded = 0
  let statutoryProfilesSkipped = 0

  // 1. Backfill CompanyPayRule for each Company
  console.log('\n[1/2] Evaluating Companies for CompanyPayRule...')
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: 'asc' },
    include: { payRule: true },
  })

  for (const company of companies) {
    companiesEvaluated++
    if (company.payRule) {
      console.log(`  [SKIP] Company "${company.name}" (${company.code}) already has payRule (id: ${company.payRule.id})`)
      companyPayRulesSkipped++
      continue
    }

    companyPayRulesNeeded++
    console.log(`  [${isDryRun ? 'DRY-RUN' : 'APPLY'}] Create default CompanyPayRule for company "${company.name}" (${company.code}):`)
    console.log(`         workingDaysBasis: CALENDAR, otMultiplier: 1.50, cutoffDay: 25, currency: INR, timezone: ${company.timezone || 'Asia/Kolkata'}`)

    if (!isDryRun) {
      await prisma.companyPayRule.create({
        data: {
          companyId: company.id,
          workingDaysBasis: 'CALENDAR',
          lopDivisor: null,
          otMultiplier: new Prisma.Decimal('1.50'),
          payrollCutoffDay: 25,
          currency: 'INR',
          timezone: company.timezone || 'Asia/Kolkata',
        },
      })
    }
  }

  // 2. Backfill SalaryStructure & StatutoryProfile from Employee.baseSalary
  console.log('\n[2/2] Evaluating Employees for SalaryStructure & StatutoryProfile...')
  const employees = await prisma.employee.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { name: true, email: true } },
      salaryStructures: { where: { effectiveTo: null } },
      statutoryProfile: true,
    },
  })

  for (const emp of employees) {
    employeesEvaluated++
    const empLabel = `${emp.employeeCode} - ${emp.user?.name || 'Unknown'} (${emp.user?.email || 'no-email'})`

    // Salary Structure check
    if (emp.salaryStructures.length > 0) {
      console.log(`  [SKIP] Employee ${empLabel} already has active salaryStructure`)
      salaryStructuresSkipped++
    } else {
      salaryStructuresNeeded++
      const baseAmount = new Prisma.Decimal(emp.baseSalary)
      console.log(`  [${isDryRun ? 'DRY-RUN' : 'APPLY'}] Create SalaryStructure with BASIC component (₹${baseAmount.toFixed(2)}) for ${empLabel}`)

      if (!isDryRun) {
        await prisma.salaryStructure.create({
          data: {
            employeeId: emp.id,
            effectiveFrom: emp.joinedAt || new Date(),
            effectiveTo: null,
            components: {
              create: [
                {
                  name: 'BASIC',
                  type: 'EARNING',
                  amount: baseAmount,
                  isTaxable: true,
                  isStatutory: true,
                },
              ],
            },
          },
        })
      }
    }

    // Statutory Profile check
    if (emp.statutoryProfile) {
      statutoryProfilesSkipped++
    } else {
      statutoryProfilesNeeded++
      console.log(`  [${isDryRun ? 'DRY-RUN' : 'APPLY'}] Create StatutoryProfile (PF: true/cap, ESI: false, PT: TN, TDS: NEW) for ${empLabel}`)

      if (!isDryRun) {
        await prisma.statutoryProfile.create({
          data: {
            employeeId: emp.id,
            pfApplicable: true,
            pfCeiling: true,
            esiApplicable: false,
            ptState: 'TN',
            tdsRegime: 'NEW',
            declarations: null,
          },
        })
      }
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('BACKFILL SUMMARY REPORT')
  console.log('='.repeat(70))
  console.log(`Mode:                     ${isDryRun ? 'DRY RUN (no DB mutations written)' : 'LIVE (mutations committed)'}`)
  console.log(`Companies evaluated:      ${companiesEvaluated}`)
  console.log(`  - PayRules needed:      ${companyPayRulesNeeded}`)
  console.log(`  - PayRules skipped:     ${companyPayRulesSkipped}`)
  console.log(`Employees evaluated:      ${employeesEvaluated}`)
  console.log(`  - Structures needed:    ${salaryStructuresNeeded}`)
  console.log(`  - Structures skipped:   ${salaryStructuresSkipped}`)
  console.log(`  - Profiles needed:      ${statutoryProfilesNeeded}`)
  console.log(`  - Profiles skipped:     ${statutoryProfilesSkipped}`)
  console.log('='.repeat(70))
}

main()
  .catch((e) => {
    console.error('[MIGRATION_ERROR]', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

