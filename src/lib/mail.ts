// Provider-agnostic mailer using Resend HTTP API (fetch, zero extra SDK)
// Includes no-op dev mode when process.env.EMAIL_ENABLED !== 'true'

import { db } from '@/lib/db'
import {
  renderPasswordResetEmail,
  renderEmployeeInviteEmail,
  renderLeaveStatusEmail,
  renderPayslipReadyEmail,
  type PasswordResetTemplateData,
  type EmployeeInviteTemplateData,
  type LeaveStatusTemplateData,
  type PayslipReadyTemplateData,
} from '@/lib/mail-templates'

export interface SendMailOptions {
  to: string | string[]
  subject: string
  html: string
  template?: string
}

export interface SendMailResult {
  ok: boolean
  id?: string
  error?: string
}

export function isEmailEnabled(): boolean {
  return process.env.EMAIL_ENABLED === 'true'
}

export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  const recipients = Array.isArray(options.to) ? options.to : [options.to]
  const toStr = recipients.join(', ')
  const emailFrom = process.env.EMAIL_FROM || 'UniHR <notifications@unihr.local>'

  // DEV / CI NO-OP MODE: If EMAIL_ENABLED is not 'true', log and succeed without external network calls
  if (!isEmailEnabled()) {
    console.log(`[EMAIL:DEV_NOOP] To: ${toStr} | Subject: "${options.subject}" | Template: ${options.template || 'generic'}`)
    if (process.env.NODE_ENV !== 'test') {
      try {
        await db.emailLog.create({
          data: {
            to: toStr,
            subject: options.subject,
            template: options.template ?? null,
            status: 'NOOP_DEV',
            error: null,
          },
        })
      } catch (err) {
        console.error('[EMAIL:LOG_ERROR]', err)
      }
    }
    return { ok: true, id: 'dev-noop' }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    const errorMsg = 'RESEND_API_KEY is not configured in environment'
    console.error(`[EMAIL:FAILED] ${errorMsg}`)
    try {
      await db.emailLog.create({
        data: {
          to: toStr,
          subject: options.subject,
          template: options.template ?? null,
          status: 'FAILED',
          error: errorMsg,
        },
      })
    } catch {}
    return { ok: false, error: errorMsg }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: recipients,
        subject: options.subject,
        html: options.html,
      }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const errMessage = (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string')
        ? data.message
        : `Resend HTTP error ${response.status}`

      await db.emailLog.create({
        data: {
          to: toStr,
          subject: options.subject,
          template: options.template ?? null,
          status: 'FAILED',
          error: errMessage,
        },
      }).catch(() => {})

      return { ok: false, error: errMessage }
    }

    const emailId = (data && typeof data === 'object' && 'id' in data && typeof data.id === 'string')
      ? data.id
      : 'sent'

    await db.emailLog.create({
      data: {
        to: toStr,
        subject: options.subject,
        template: options.template ?? null,
        status: 'SENT',
        error: null,
      },
    }).catch(() => {})

    return { ok: true, id: emailId }
  } catch (error) {
    const errStr = error instanceof Error ? error.message : String(error)
    console.error('[EMAIL:EXCEPTION]', errStr)
    await db.emailLog.create({
      data: {
        to: toStr,
        subject: options.subject,
        template: options.template ?? null,
        status: 'FAILED',
        error: errStr,
      },
    }).catch(() => {})

    return { ok: false, error: errStr }
  }
}

// Typed Helper Functions
export async function sendPasswordResetEmail(
  to: string,
  data: PasswordResetTemplateData
): Promise<SendMailResult> {
  return sendMail({
    to,
    subject: 'Reset Your UniHR Password',
    html: renderPasswordResetEmail(data),
    template: 'passwordReset',
  })
}

export async function sendEmployeeInviteEmail(
  to: string,
  data: EmployeeInviteTemplateData
): Promise<SendMailResult> {
  return sendMail({
    to,
    subject: `Welcome to ${data.companyName} on UniHR`,
    html: renderEmployeeInviteEmail(data),
    template: 'employeeInvite',
  })
}

export async function sendLeaveStatusEmail(
  to: string,
  data: LeaveStatusTemplateData
): Promise<SendMailResult> {
  return sendMail({
    to,
    subject: `Leave Request ${data.status}: ${data.leaveType}`,
    html: renderLeaveStatusEmail(data),
    template: 'leaveStatus',
  })
}

export async function sendPayslipReadyEmail(
  to: string,
  data: PayslipReadyTemplateData
): Promise<SendMailResult> {
  return sendMail({
    to,
    subject: `Payslip Available for ${data.month}/${data.year}`,
    html: renderPayslipReadyEmail(data),
    template: 'payslipReady',
  })
}
