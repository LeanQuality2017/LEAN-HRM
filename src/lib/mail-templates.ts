// UniHR Transactional Email Templates
// Accessible, plain HTML with zero external styles/CDNs (CSP compliant)

export interface PasswordResetTemplateData {
  name: string
  resetUrl: string
  expiresInMinutes?: number
}

export interface EmployeeInviteTemplateData {
  name: string
  companyName: string
  loginUrl: string
  tempPassword?: string
}

export interface LeaveStatusTemplateData {
  name: string
  leaveType: string
  startDate: string
  endDate: string
  status: string
  reviewerComment?: string | null
}

export interface PayslipReadyTemplateData {
  name: string
  month: number
  year: number
  netPay: string | number
  viewUrl: string
}

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UniHR Notification</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
    <tr>
      <td style="background-color: #0f766e; padding: 20px 24px; text-align: left;">
        <span style="color: #ffffff; font-size: 20px; font-weight: bold; letter-spacing: -0.5px;">UniHR</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 24px;">
        ${content}
      </td>
    </tr>
    <tr>
      <td style="background-color: #f1f5f9; padding: 16px 24px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0;">
        This is an automated notification from your UniHR system. Please do not reply directly to this email.
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function renderPasswordResetEmail(data: PasswordResetTemplateData): string {
  const mins = data.expiresInMinutes ?? 30
  const content = `
    <h2 style="font-size: 18px; font-weight: 600; margin-top: 0; color: #0f172a;">Password Reset Request</h2>
    <p style="font-size: 14px; line-height: 1.5; color: #334155;">Hello ${escapeHtml(data.name)},</p>
    <p style="font-size: 14px; line-height: 1.5; color: #334155;">
      We received a request to reset the password for your UniHR account. Click the button below to choose a new password:
    </p>
    <div style="margin: 24px 0; text-align: center;">
      <a href="${data.resetUrl}" style="background-color: #0f766e; color: #ffffff; padding: 12px 24px; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 6px; display: inline-block;">
        Reset Password
      </a>
    </div>
    <p style="font-size: 13px; line-height: 1.5; color: #64748b;">
      This link will expire in <strong>${mins} minutes</strong>. If you did not request a password reset, you can safely ignore this email; your account remains secure.
    </p>
    <div style="border-top: 1px solid #e2e8f0; margin-top: 20px; padding-top: 12px; font-size: 12px; color: #94a3b8; word-break: break-all;">
      Or copy and paste this link in your browser: <br>${data.resetUrl}
    </div>
  `
  return baseLayout(content)
}

export function renderEmployeeInviteEmail(data: EmployeeInviteTemplateData): string {
  const content = `
    <h2 style="font-size: 18px; font-weight: 600; margin-top: 0; color: #0f172a;">Welcome to UniHR</h2>
    <p style="font-size: 14px; line-height: 1.5; color: #334155;">Hello ${escapeHtml(data.name)},</p>
    <p style="font-size: 14px; line-height: 1.5; color: #334155;">
      You have been invited to join <strong>${escapeHtml(data.companyName)}</strong> on UniHR.
    </p>
    ${
      data.tempPassword
        ? `<div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px 16px; margin: 16px 0;">
            <p style="margin: 0; font-size: 13px; color: #475569;">Temporary Password: <code style="font-size: 14px; font-weight: bold; color: #0f766e;">${escapeHtml(data.tempPassword)}</code></p>
          </div>`
        : ''
    }
    <div style="margin: 24px 0; text-align: center;">
      <a href="${data.loginUrl}" style="background-color: #0f766e; color: #ffffff; padding: 12px 24px; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 6px; display: inline-block;">
        Sign In to Your Account
      </a>
    </div>
  `
  return baseLayout(content)
}

export function renderLeaveStatusEmail(data: LeaveStatusTemplateData): string {
  const isApproved = data.status === 'APPROVED'
  const badgeColor = isApproved ? '#16a34a' : '#dc2626'
  const badgeBg = isApproved ? '#f0fdf4' : '#fef2f2'

  const content = `
    <h2 style="font-size: 18px; font-weight: 600; margin-top: 0; color: #0f172a;">Leave Request Update</h2>
    <p style="font-size: 14px; line-height: 1.5; color: #334155;">Hello ${escapeHtml(data.name)},</p>
    <p style="font-size: 14px; line-height: 1.5; color: #334155;">
      Your leave request for <strong>${escapeHtml(data.leaveType)}</strong> (${data.startDate} to ${data.endDate}) has been:
    </p>
    <div style="margin: 16px 0;">
      <span style="background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor}; padding: 6px 12px; border-radius: 4px; font-weight: 600; font-size: 13px;">
        ${escapeHtml(data.status)}
      </span>
    </div>
    ${
      data.reviewerComment
        ? `<p style="font-size: 13px; line-height: 1.5; color: #475569; background-color: #f8fafc; padding: 12px; border-radius: 6px; border-left: 3px solid #94a3b8;">
            <strong>Reviewer Note:</strong> ${escapeHtml(data.reviewerComment)}
          </p>`
        : ''
    }
  `
  return baseLayout(content)
}

export function renderPayslipReadyEmail(data: PayslipReadyTemplateData): string {
  const content = `
    <h2 style="font-size: 18px; font-weight: 600; margin-top: 0; color: #0f172a;">Payslip Available</h2>
    <p style="font-size: 14px; line-height: 1.5; color: #334155;">Hello ${escapeHtml(data.name)},</p>
    <p style="font-size: 14px; line-height: 1.5; color: #334155;">
      Your payslip for <strong>${data.month}/${data.year}</strong> has been generated and is now ready for viewing.
    </p>
    <div style="background-color: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 6px; padding: 16px; margin: 16px 0; text-align: center;">
      <span style="font-size: 12px; text-transform: uppercase; color: #0f766e; font-weight: 600;">Net Salary</span>
      <div style="font-size: 24px; font-weight: bold; color: #115e59; margin-top: 4px;">₹${data.netPay}</div>
    </div>
    <div style="margin: 24px 0; text-align: center;">
      <a href="${data.viewUrl}" style="background-color: #0f766e; color: #ffffff; padding: 12px 24px; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 6px; display: inline-block;">
        View Payslip
      </a>
    </div>
  `
  return baseLayout(content)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

