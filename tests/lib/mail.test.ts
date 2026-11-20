import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  renderPasswordResetEmail,
  renderEmployeeInviteEmail,
  renderLeaveStatusEmail,
  renderPayslipReadyEmail,
} from '@/lib/mail-templates'
import { sendMail, isEmailEnabled } from '@/lib/mail'

describe('Transactional Mail Templates (src/lib/mail-templates.ts)', () => {
  it('should render password reset email with correct reset link and expiry', () => {
    const html = renderPasswordResetEmail({
      name: 'John Doe',
      resetUrl: 'http://localhost:3001/reset-password?token=abcdef123456',
      expiresInMinutes: 30,
    })

    expect(html).toContain('Password Reset Request')
    expect(html).toContain('John Doe')
    expect(html).toContain('http://localhost:3001/reset-password?token=abcdef123456')
    expect(html).toContain('30 minutes')
    expect(html).not.toContain('<script')
  })

  it('should render employee invite email with temporary password and company name', () => {
    const html = renderEmployeeInviteEmail({
      name: 'Jane Smith',
      companyName: 'Alpha Technologies',
      loginUrl: 'http://localhost:3001/login',
      tempPassword: 'TempPassword123!',
    })

    expect(html).toContain('Welcome to UniHR')
    expect(html).toContain('Jane Smith')
    expect(html).toContain('Alpha Technologies')
    expect(html).toContain('TempPassword123!')
    expect(html).toContain('http://localhost:3001/login')
  })

  it('should render leave status email for APPROVED and REJECTED status', () => {
    const approvedHtml = renderLeaveStatusEmail({
      name: 'Alex Johnson',
      leaveType: 'Casual Leave',
      startDate: '2026-11-25',
      endDate: '2026-11-26',
      status: 'APPROVED',
      reviewerComment: 'Have a restful break',
    })

    expect(approvedHtml).toContain('Alex Johnson')
    expect(approvedHtml).toContain('Casual Leave')
    expect(approvedHtml).toContain('APPROVED')
    expect(approvedHtml).toContain('Have a restful break')

    const rejectedHtml = renderLeaveStatusEmail({
      name: 'Alex Johnson',
      leaveType: 'Privilege Leave',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      status: 'REJECTED',
      reviewerComment: 'Staffing shortage on those dates',
    })

    expect(rejectedHtml).toContain('REJECTED')
    expect(rejectedHtml).toContain('Staffing shortage on those dates')
  })

  it('should render payslip ready email with salary and period details', () => {
    const html = renderPayslipReadyEmail({
      name: 'Sara Lee',
      month: 11,
      year: 2026,
      netPay: '65,000.00',
      viewUrl: 'http://localhost:3001/payroll',
    })

    expect(html).toContain('Payslip Available')
    expect(html).toContain('Sara Lee')
    expect(html).toContain('11/2026')
    expect(html).toContain('₹65,000.00')
    expect(html).toContain('http://localhost:3001/payroll')
  })
})

describe('Mailer Dispatcher (src/lib/mail.ts)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should detect when EMAIL_ENABLED is active', () => {
    process.env.EMAIL_ENABLED = 'true'
    expect(isEmailEnabled()).toBe(true)

    process.env.EMAIL_ENABLED = 'false'
    expect(isEmailEnabled()).toBe(false)

    delete process.env.EMAIL_ENABLED
    expect(isEmailEnabled()).toBe(false)
  })

  it('should safely execute in no-op dev mode without external HTTP requests', async () => {
    process.env.EMAIL_ENABLED = 'false'
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await sendMail({
      to: 'recipient@example.com',
      subject: 'Dev Test Email',
      html: '<p>Test content</p>',
      template: 'test',
    })

    expect(result.ok).toBe(true)
    expect(result.id).toBe('dev-noop')
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[EMAIL:DEV_NOOP] To: recipient@example.com')
    )

    consoleSpy.mockRestore()
  })
})

