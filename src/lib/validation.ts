import { z } from 'zod'
import { ApiError } from '@/lib/api-auth'
import {
  ROLES,
  ATTENDANCE_STATUSES,
  ATTENDANCE_SOURCES,
  LEAVE_STATUSES,
  PAYROLL_STATUSES,
  REPORT_STATUSES,
  JOB_STATUSES,
  APP_STATUSES,
  REVIEW_STATUSES,
  STUDENT_STATUSES,
  BATCH_STATUSES,
  PAYMENT_METHODS,
  PLACEMENT_STATUSES,
  COMPANY_TYPES,
} from '@/lib/constants'

// Generic helper to parse data or throw 400 ApiError
export function validateBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : ''
    throw new ApiError(400, `${path}${issue?.message || 'Invalid input'}`)
  }
  return result.data
}

// Common primitive schemas
export const shortString = z.string().trim().max(120, 'Maximum 120 characters allowed')
export const nameSchema = z.string().trim().min(1, 'Name is required').max(120, 'Name cannot exceed 120 characters')
export const emailSchema = z.string().trim().email('Enter a valid email address.').max(120, 'Email cannot exceed 120 characters')
export const passwordSchema = z
  .string()
  .min(8, 'Password must be 8+ characters with at least one letter and one digit.')
  .max(120, 'Password cannot exceed 120 characters')
  .regex(/^(?=.*[a-zA-Z])(?=.*\d)/, 'Password must be 8+ characters with at least one letter and one digit.')
export const textField = z.string().trim().max(2000, 'Text field cannot exceed 2000 characters')
export const longTextField = z.string().trim().max(5000, 'Notes/description cannot exceed 5000 characters')
export const nonNegativeAmount = z.coerce.number().min(0, 'Amount cannot be negative')
export const salarySchema = z.coerce.number().min(0, 'Salary cannot be negative').max(9999999999.99, 'Salary cannot exceed 9,999,999,999.99')
export const positiveAmount = z.coerce.number().positive('Amount must be greater than 0')
export const ratingSchema = z.coerce.number().min(0, 'Rating must be at least 0').max(5, 'Rating cannot exceed 5')

// Enums
export const roleEnum = z.enum([
  ROLES.SUPER_ADMIN,
  ROLES.COMPANY_ADMIN,
  ROLES.HR,
  ROLES.MANAGER,
  ROLES.EMPLOYEE,
  ROLES.STUDENT,
])

export const attendanceStatusEnum = z.enum(ATTENDANCE_STATUSES)
export const attendanceSourceEnum = z.enum(ATTENDANCE_SOURCES)
export const leaveStatusEnum = z.enum(LEAVE_STATUSES)
export const payrollStatusEnum = z.enum(PAYROLL_STATUSES)
export const reportStatusEnum = z.enum(REPORT_STATUSES)
export const jobStatusEnum = z.enum(JOB_STATUSES)
export const appStatusEnum = z.enum(APP_STATUSES)
export const reviewStatusEnum = z.enum(REVIEW_STATUSES)
export const studentStatusEnum = z.enum(STUDENT_STATUSES)
export const batchStatusEnum = z.enum(BATCH_STATUSES)
export const paymentMethodEnum = z.enum(PAYMENT_METHODS)
export const placementStatusEnum = z.enum(PLACEMENT_STATUSES)
export const companyTypeEnum = z.enum(COMPANY_TYPES)

// 1. Announcements
export const announcementCreateSchema = z.object({
  title: nameSchema,
  content: z.string().trim().min(1, 'Content is required').max(2000, 'Content cannot exceed 2000 characters'),
  companyId: shortString.nullish(),
})

// 2. Applications
export const applicationCreateSchema = z.object({
  jobOpeningId: shortString.min(1, 'jobOpeningId required'),
  name: nameSchema,
  email: emailSchema,
  phone: shortString.nullish(),
  experience: z.coerce.number().min(0, 'Experience cannot be negative').nullish(),
  resumeNote: textField.nullish(),
  notes: textField.nullish(),
})

export const applicationUpdateSchema = z.object({
  status: appStatusEnum.optional(),
  notes: textField.nullish(),
})

// 3. Assessments
export const assessmentResultItemSchema = z.object({
  studentId: shortString.min(1, 'studentId required'),
  score: z.coerce.number().min(0, 'Score cannot be negative'),
  remarks: textField.nullish(),
})

export const assessmentCreateSchema = z.object({
  batchId: shortString.min(1, 'batchId required'),
  title: nameSchema,
  date: z.string().min(1, 'Date is required'),
  maxScore: z.coerce.number().positive('maxScore must be greater than 0').default(100),
  results: z.array(assessmentResultItemSchema).optional(),
})

export const assessmentPatchSchema = z.object({
  results: z.array(assessmentResultItemSchema).min(1, 'results array required'),
})

// 4. Assignments
export const assignmentCreateSchema = z.object({
  employeeId: shortString.min(1, 'employeeId required'),
  companyId: shortString.min(1, 'companyId required'),
  isPrimary: z.boolean().optional(),
  designation: shortString.optional(),
})

export const assignmentUpdateSchema = z.object({
  id: shortString.optional(),
  employeeId: shortString.optional(),
  companyId: shortString.optional(),
  isPrimary: z.boolean().optional(),
  designation: shortString.optional(),
})

// 5. Attendance
export const attendancePatchSchema = z.object({
  status: attendanceStatusEnum.optional(),
  source: attendanceSourceEnum.optional(),
  checkIn: z.string().nullish(),
  checkOut: z.string().nullish(),
  note: textField.nullish(),
})

// 6. Auth change-password
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'currentPassword required').max(120),
  newPassword: passwordSchema,
})

// 7. Batches
export const batchCreateSchema = z.object({
  courseId: shortString.min(1, 'courseId required'),
  name: nameSchema,
  startDate: z.string().min(1, 'startDate required'),
  endDate: z.string().nullish(),
  capacity: z.coerce.number().int().positive('Capacity must be positive').default(30),
  status: batchStatusEnum.optional(),
})

export const batchUpdateSchema = z.object({
  name: shortString.optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullish(),
  capacity: z.coerce.number().int().positive('Capacity must be positive').optional(),
  status: batchStatusEnum.optional(),
})

// 8. Companies
export const companyCreateSchema = z.object({
  name: nameSchema,
  code: shortString.min(1, 'code required'),
  type: companyTypeEnum.optional(),
  address: textField.nullish(),
  phone: shortString.nullish(),
  email: emailSchema.nullish(),
  adminEmail: emailSchema.nullish(),
  adminPassword: passwordSchema.nullish(),
  adminName: shortString.nullish(),
})

export const companyUpdateSchema = z.object({
  name: shortString.optional(),
  code: shortString.optional(),
  type: companyTypeEnum.optional(),
  address: textField.nullish(),
  phone: shortString.nullish(),
  email: emailSchema.nullish(),
  isActive: z.boolean().optional(),
})

// 9. Courses
export const courseCreateSchema = z.object({
  name: nameSchema,
  code: shortString.min(1, 'code required'),
  description: textField.nullish(),
  durationWeeks: z.coerce.number().int().positive('durationWeeks must be at least 1').default(8),
  fee: nonNegativeAmount.default(0),
})

export const courseUpdateSchema = z.object({
  name: shortString.optional(),
  code: shortString.optional(),
  description: textField.nullish(),
  durationWeeks: z.coerce.number().int().positive('durationWeeks must be at least 1').optional(),
  fee: nonNegativeAmount.optional(),
})

// 10. Employees
export const employeeCreateSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  companyId: shortString.min(1, 'companyId required'),
  employeeCode: shortString.min(1, 'employeeCode required'),
  role: roleEnum.optional(),
  phone: shortString.nullish(),
  designation: shortString.min(1, 'Designation is required.'),
  baseSalary: salarySchema.optional(),
  joinedAt: z.string().nullish(),
  managerId: shortString.nullish(),
  companyIds: z.array(shortString).optional(),
})

export const employeeUpdateSchema = z.object({
  name: nameSchema.optional(),
  phone: shortString.nullish(),
  designation: shortString.min(1, 'Designation is required.').optional(),
  baseSalary: salarySchema.optional(),
  managerId: shortString.nullish(),
  isActive: z.boolean().optional(),
  status: shortString.optional(),
  password: passwordSchema.optional(),
  role: roleEnum.optional(),
  companyIds: z.array(shortString).optional(),
})

// 11. Enroll
export const enrollCreateSchema = z.object({
  studentId: shortString.min(1, 'studentId required'),
  batchId: shortString.min(1, 'batchId required'),
})

// 12. Fees
export const feeCreateSchema = z.object({
  studentId: shortString.min(1, 'studentId required'),
  amount: positiveAmount,
  method: paymentMethodEnum.default('CASH'),
  invoiceNo: shortString.optional(),
  note: textField.nullish(),
})

// 13. Jobs
export const jobCreateSchema = z.object({
  companyId: shortString.min(1, 'companyId required'),
  title: nameSchema,
  department: shortString.nullish(),
  description: longTextField.nullish(),
  openings: z.coerce.number().int().positive('openings must be positive').default(1),
  status: jobStatusEnum.optional(),
})

export const jobUpdateSchema = z.object({
  title: shortString.optional(),
  department: shortString.nullish(),
  description: longTextField.nullish(),
  openings: z.coerce.number().int().positive('openings must be positive').optional(),
  status: jobStatusEnum.optional(),
})

// 14. KPIs
export const kpiCreateSchema = z.object({
  employeeId: shortString.min(1, 'employeeId required'),
  title: nameSchema,
  target: nonNegativeAmount,
  achieved: nonNegativeAmount.optional(),
  unit: shortString.optional(),
  period: shortString.min(1, 'period required'),
})

export const kpiUpdateSchema = z.object({
  achieved: nonNegativeAmount.optional(),
  target: nonNegativeAmount.optional(),
  title: shortString.optional(),
  period: shortString.optional(),
})

// 15. Leaves
export const leaveCreateSchema = z.object({
  leaveTypeId: shortString.min(1, 'leaveTypeId required'),
  startDate: z.string().min(1, 'startDate required'),
  endDate: z.string().min(1, 'endDate required'),
  reason: z.string().trim().min(1, 'reason required').max(2000, 'reason cannot exceed 2000 characters'),
  employeeId: shortString.optional(),
})

export const leavePatchSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'CANCELLED']),
  comment: textField.nullish(),
})

// 16. Notifications
export const notificationPatchSchema = z.object({
  id: shortString.optional(),
  all: z.boolean().optional(),
})

// 17. Payroll
export const payrollCreateSchema = z.object({
  companyId: shortString.optional(),
  month: z.coerce.number().int().min(1, 'month must be between 1 and 12').max(12, 'month must be between 1 and 12'),
  year: z.coerce.number().int().min(2000, 'year must be >= 2000').max(2100, 'year must be <= 2100'),
})

export const payrollUpdateSchema = z.object({
  status: payrollStatusEnum.optional(),
  basic: nonNegativeAmount.optional(),
  allowances: nonNegativeAmount.optional(),
  deductions: nonNegativeAmount.optional(),
})

// 18. Placements
export const placementCreateSchema = z.object({
  studentId: shortString.min(1, 'studentId required'),
  companyName: nameSchema,
  role: shortString.min(1, 'role required'),
  salary: nonNegativeAmount.nullish(),
  placedAt: z.string().nullish(),
  status: placementStatusEnum.optional(),
})

export const placementUpdateSchema = z.object({
  companyName: shortString.optional(),
  role: shortString.optional(),
  salary: nonNegativeAmount.nullish(),
  placedAt: z.string().nullish(),
  status: placementStatusEnum.optional(),
})

// 19. Profile
export const profileUpdateSchema = z.object({
  name: shortString.optional(),
  phone: shortString.nullish(),
  currentPassword: z.string().optional(),
  newPassword: passwordSchema.optional(),
})

// 20. Reviews
export const reviewsGetQuerySchema = z.object({
  employeeId: shortString.optional(),
})

export const reviewCreateSchema = z.object({
  employeeId: shortString.min(1, 'employeeId required'),
  period: shortString.min(1, 'period required'),
  goals: z.string().trim().min(1, 'goals required').max(2000, 'goals cannot exceed 2000 characters'),
})

export const reviewUpdateSchema = z.object({
  rating: ratingSchema.nullish(),
  comments: textField.nullish(),
  goals: textField.nullish(),
})

// 21. Students
export const studentCreateSchema = z.object({
  name: nameSchema,
  email: emailSchema.nullish(),
  password: passwordSchema.nullish(),
  phone: shortString.nullish(),
  qualification: shortString.nullish(),
  batchId: shortString.nullish(),
  status: studentStatusEnum.optional(),
})

export const studentUpdateSchema = z.object({
  name: shortString.optional(),
  email: emailSchema.nullish(),
  phone: shortString.nullish(),
  qualification: shortString.nullish(),
  status: studentStatusEnum.optional(),
})

// 22. Users
export const userCreateSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: roleEnum,
  password: passwordSchema,
  companyId: shortString.min(1, 'companyId required'),
  employeeCode: shortString.optional(),
  designation: shortString.min(1, 'Designation is required.').optional(),
  baseSalary: salarySchema.optional(),
  phone: shortString.nullish(),
})

export const userResetPasswordSchema = z.object({
  userId: shortString.min(1, 'userId required'),
  newPassword: passwordSchema,
})

// 23. Work reports
export const workReportCreateSchema = z.object({
  tasks: z.string().trim().min(1, 'tasks required').max(2000, 'tasks cannot exceed 2000 characters'),
  hoursWorked: z.coerce.number().min(0, 'hoursWorked cannot be negative').max(24, 'hoursWorked cannot exceed 24').default(8),
  date: z.string().min(1, 'date required'),
  blockers: textField.nullish(),
})

export const workReportReviewSchema = z.object({
  comment: z.string().trim().min(1, 'comment required').max(2000, 'comment cannot exceed 2000 characters'),
})

// 24. Biometric Attendance Sync
export const biometricPunchItemSchema = z
  .object({
    employeeCode: z.string().trim().min(1, 'employeeCode is required').max(120),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
    checkIn: z.string().nullish(),
    checkOut: z.string().nullish(),
    companyId: shortString.nullish(),
  })
  .strip()

export const biometricSyncSchema = z.object({
  punches: z
    .array(biometricPunchItemSchema)
    .max(500, 'Batch size exceeds maximum limit of 500 punches'),
})

// 25. Export Query
export const EXPORT_TYPES = ['attendance', 'payroll', 'students', 'fees'] as const
export type ExportType = (typeof EXPORT_TYPES)[number]

export const exportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD').optional(),
})

export function formatCsvCell(val: unknown): string {
  if (val === null || val === undefined) return ''
  let str = String(val)
  // FORMULA INJECTION GUARD: any cell starting with =, +, -, @, \t, or \r gets a leading apostrophe
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`
  }
  // Standard CSV escaping: wrap in quotes if contains comma, quote, or newline; double inner quotes
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}



