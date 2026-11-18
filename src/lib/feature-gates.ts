/**
 * Feature gates for UniHR modules.
 * Payroll and Institute modules are gated OFF by default outside approved demo environments
 * until durable legal-entity, pay rule reconciliation, and tenant isolation models are implemented.
 */

export function isDemoModulesEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false
  }
  return process.env.ENABLE_DEMO_MODULES === 'true'
}

export function isPayrollEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false
  }
  return isDemoModulesEnabled()
}

export function isInstituteEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false
  }
  return isDemoModulesEnabled()
}
