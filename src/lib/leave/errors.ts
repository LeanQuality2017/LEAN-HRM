export class LeaveBalanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LeaveBalanceError'
  }
}

