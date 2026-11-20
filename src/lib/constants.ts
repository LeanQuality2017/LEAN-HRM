// UniHR shared constants (SQLite has no enums)
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  HR: 'HR',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
  STUDENT: 'STUDENT',
} as const
export type Role = (typeof ROLES)[keyof typeof ROLES]

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Company Admin',
  HR: 'HR',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
  STUDENT: 'Student',
}

export const ATTENDANCE_STATUSES = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE', 'WFH', 'HOLIDAY'] as const
export const ATTENDANCE_SOURCES = ['WEB', 'BIOMETRIC', 'MANUAL'] as const
export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const
export const PAYROLL_STATUSES = ['DRAFT', 'LOCKED', 'PROCESSED', 'PAID'] as const
export const REPORT_STATUSES = ['SUBMITTED', 'REVIEWED'] as const
export const JOB_STATUSES = ['OPEN', 'ON_HOLD', 'CLOSED'] as const
export const APP_STATUSES = ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'] as const
export const REVIEW_STATUSES = ['PENDING', 'COMPLETED'] as const
export const STUDENT_STATUSES = ['ENQUIRY', 'ENROLLED', 'IN_TRAINING', 'TRAINED', 'PLACED', 'DROPPED'] as const
export const BATCH_STATUSES = ['UPCOMING', 'ONGOING', 'COMPLETED'] as const
export const ENROLL_STATUSES = ['ACTIVE', 'COMPLETED', 'DROPPED'] as const
export const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK', 'CARD'] as const
export const PLACEMENT_STATUSES = ['PLACED', 'JOINED', 'WITHDRAWN'] as const
export const COMPANY_TYPES = ['NORMAL', 'INSTITUTE'] as const

export const ATTENDANCE_STATUS = {
  PRESENT: 'PRESENT',
  LATE: 'LATE',
  HALF_DAY: 'HALF_DAY',
  ABSENT: 'ABSENT',
  LEAVE: 'LEAVE',
  WFH: 'WFH',
  HOLIDAY: 'HOLIDAY',
} as const

export const LEAVE_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const

export const PAYROLL_STATUS = {
  DRAFT: 'DRAFT',
  LOCKED: 'LOCKED',
  PROCESSED: 'PROCESSED',
  PAID: 'PAID',
} as const

export const REPORT_STATUS = {
  SUBMITTED: 'SUBMITTED',
  REVIEWED: 'REVIEWED',
} as const

export const REVIEW_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
} as const

export const APP_STATUS = {
  NEW: 'NEW',
  SCREENING: 'SCREENING',
  INTERVIEW: 'INTERVIEW',
  OFFER: 'OFFER',
  HIRED: 'HIRED',
  REJECTED: 'REJECTED',
} as const

export const STUDENT_STATUS = {
  ENQUIRY: 'ENQUIRY',
  ENROLLED: 'ENROLLED',
  IN_TRAINING: 'IN_TRAINING',
  TRAINED: 'TRAINED',
  PLACED: 'PLACED',
  DROPPED: 'DROPPED',
} as const

export const AUDIT_ACTIONS = {
  USER_CREATE: 'USER_CREATE',
  USER_ROLE_CHANGE: 'USER_ROLE_CHANGE',
  USER_DEACTIVATE: 'USER_DEACTIVATE',
  EMPLOYEE_CREATE: 'EMPLOYEE_CREATE',
  EMPLOYEE_ASSIGN: 'EMPLOYEE_ASSIGN',
  EMPLOYEE_UNASSIGN: 'EMPLOYEE_UNASSIGN',
  LEAVE_APPROVE: 'LEAVE_APPROVE',
  LEAVE_REJECT: 'LEAVE_REJECT',
  PAYROLL_GENERATE: 'PAYROLL_GENERATE',
  PAYROLL_LOCK: 'PAYROLL_LOCK',
  PAYROLL_PROCESS: 'PAYROLL_PROCESS',
  PAYROLL_PAY: 'PAYROLL_PAY',
  PAYROLL_MANUAL_EDIT: 'PAYROLL_MANUAL_EDIT',
  WORK_REPORT_REVIEW: 'WORK_REPORT_REVIEW',
  FEE_CREATE: 'FEE_CREATE',
  ASSESSMENT_CREATE: 'ASSESSMENT_CREATE',
  COMPANY_CREATE: 'COMPANY_CREATE',
  COMPANY_DELETE: 'COMPANY_DELETE',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ATTENDANCE_SYNC: 'ATTENDANCE_SYNC',
  EXPORT: 'EXPORT',
  DOCUMENT_UPLOAD: 'DOCUMENT_UPLOAD',
  STEP_UP_SUCCESS: 'STEP_UP_SUCCESS',
  STEP_UP_FAILURE: 'STEP_UP_FAILURE',
} as const

// Role groups for authorization
export const ADMIN_ROLES: string[] = [ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN]
export const HR_ROLES: string[] = [ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN, ROLES.HR]
export const MANAGEMENT_ROLES: string[] = [ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN, ROLES.HR, ROLES.MANAGER]
export const STAFF_ROLES: string[] = [ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN, ROLES.HR, ROLES.MANAGER, ROLES.EMPLOYEE]
export const INSTITUTE_ROLES: string[] = [ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN]

export function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return '-'
  return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—'
  const num = typeof n === 'number' ? n : Number(n)
  if (isNaN(num)) return '—'
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function todayISO(): string {
  const d = new Date()
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return tz.toISOString().slice(0, 10)
}
