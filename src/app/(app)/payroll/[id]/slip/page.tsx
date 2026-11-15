export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { requirePageAuth } from '@/lib/page-auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { fmtDate, fmtMoney, HR_ROLES } from '@/lib/constants'
import { ArrowLeft } from 'lucide-react'
import { PrintButton } from './print-button'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function statusBadge(s: string) {
  const map: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    PROCESSED: 'bg-amber-100 text-amber-800',
    PAID: 'bg-emerald-100 text-emerald-800',
  }
  return <Badge className={`${map[s] ?? 'bg-gray-100'} text-xs border-0`}>{s}</Badge>
}

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePageAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'])
  const { role, userId, administeredCompanyIds } = auth

  const { id } = await params

  const payslip = await db.payroll.findUnique({
    where: { id },
    include: {
      employee: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          assignments: {
            include: { company: true },
          },
        },
      },
      generatedBy: { select: { name: true, email: true } },
    },
  })

  if (!payslip) {
    redirect('/payroll')
  }

  const isOwner = payslip.employee.userId === userId
  let isAuthorized = false

  if (role === 'SUPER_ADMIN') {
    isAuthorized = true
  } else if (HR_ROLES.includes(role)) {
    const empCompanyIds = payslip.employee.assignments.map((a) => a.companyId)
    if (administeredCompanyIds && empCompanyIds.some((cid) => administeredCompanyIds.includes(cid))) {
      isAuthorized = true
    }
  } else if (isOwner && role !== 'MANAGER') {
    isAuthorized = true
  }

  if (!isAuthorized) {
    redirect('/payroll')
  }

  const basic = Number(payslip.basic)
  const allowances = Number(payslip.allowances)
  const deductions = Number(payslip.deductions)
  const netPay = Number(payslip.netPay)

  const primaryAssignment = payslip.employee.assignments.find((a) => a.isPrimary) || payslip.employee.assignments[0]
  const company = primaryAssignment?.company

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <style>{`
        @media print {
          header, aside, .no-print, nav, button, a {
            display: none !important;
          }
          body, main {
            background: white !important;
            color: black !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .print-card {
            box-shadow: none !important;
            border: 1px solid #ddd !important;
          }
        }
      `}</style>

      <div className="no-print flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/payroll">
            <ArrowLeft className="h-4 w-4" />
            Back to Payroll
          </Link>
        </Button>
        <PrintButton />
      </div>

      <Card className="print-card border bg-card">
        <CardContent className="p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start border-b pb-4">
            <div>
              <h2 className="text-xl font-bold text-foreground">{company?.name || 'UniHR'}</h2>
              {company?.code && <p className="text-xs text-muted-foreground uppercase tracking-wider">Company Code: {company.code}</p>}
              {company?.address && <p className="text-xs text-muted-foreground mt-0.5">{company.address}</p>}
              <div className="text-xs text-muted-foreground flex gap-3 mt-1">
                {company?.phone && <span>Tel: {company.phone}</span>}
                {company?.email && <span>Email: {company.email}</span>}
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold uppercase tracking-wider px-2.5 py-1 bg-muted rounded">Payslip</span>
              <p className="text-base font-bold text-foreground mt-2">
                {MONTH_NAMES[payslip.month - 1]} {payslip.year}
              </p>
              <div className="mt-1">{statusBadge(payslip.status)}</div>
            </div>
          </div>

          {/* Employee & Period Details */}
          <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-lg">
            <div>
              <p className="text-xs text-muted-foreground">Employee Name</p>
              <p className="font-semibold text-foreground">{payslip.employee.user.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Employee Code</p>
              <p className="font-semibold text-foreground">{payslip.employee.employeeCode}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Designation</p>
              <p className="font-medium text-foreground">{primaryAssignment?.designation || 'Staff'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Company</p>
              <p className="font-medium text-foreground">{company?.name || '—'}</p>
            </div>
          </div>

          {/* Financial Breakdown Table */}
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left font-medium">
                <tr>
                  <th className="p-3">Description</th>
                  <th className="p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="p-3 font-medium">Basic Salary</td>
                  <td className="p-3 text-right font-medium">{fmtMoney(basic)}</td>
                </tr>
                <tr>
                  <td className="p-3 text-emerald-700">Allowances</td>
                  <td className="p-3 text-right text-emerald-700">+{fmtMoney(allowances)}</td>
                </tr>
                <tr className="bg-muted/10 font-medium">
                  <td className="p-3">Gross Earnings</td>
                  <td className="p-3 text-right">{fmtMoney(basic + allowances)}</td>
                </tr>
                <tr>
                  <td className="p-3 text-red-600">Deductions</td>
                  <td className="p-3 text-right text-red-600">−{fmtMoney(deductions)}</td>
                </tr>
                <tr className="bg-muted/40 font-bold text-base border-t-2">
                  <td className="p-3">Net Pay</td>
                  <td className="p-3 text-right text-primary">{fmtMoney(netPay)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Status & Footer */}
          <div className="pt-2 text-xs text-muted-foreground flex flex-col sm:flex-row justify-between gap-2 border-t">
            <div>
              {payslip.status === 'PAID' && (
                <p className="font-medium text-emerald-800">
                  Paid on: {fmtDate(payslip.paidAt || payslip.createdAt)}
                </p>
              )}
              <p>Generated by: {payslip.generatedBy?.name || 'System'}</p>
            </div>
            <div className="sm:text-right">
              <p>Record ID: {payslip.id}</p>
              <p>This is a computer-generated payslip and requires no physical signature.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

