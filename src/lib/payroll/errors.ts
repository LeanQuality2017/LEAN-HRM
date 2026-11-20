/**
 * UniHR Payroll Engine Domain Errors
 */

export class PayrollCalculationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayrollCalculationError'
  }
}

