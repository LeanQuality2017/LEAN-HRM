import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { GeneratePayrollButton, PayrollRowActions } from './actions'
import { fmtMoney, HR_ROLES } from '@/lib/constants'
import { Download, Wallet } from 'lucide-react'
import { PaginationControls } from '@/components/pagination-controls'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function statusBadge(s: string) {
  const map: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700', PROCESSED: 'bg-amber-100 text-amber-800', PAID: 'bg-emerald-100 text-emerald-800',
  }
  return <Badge className={`${map[s]} text-[10px] border-0`}>{s}</Badge>
}

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')
  const role = session.user.role
  const employeeId = session.user.employeeId
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'].includes(role)
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const where = isAdmin ? {} : employeeId ? { employeeId } : { id: '__none__' }

  const [totalCount, totalsAgg, payslips] = await Promise.all([
    db.payroll.count({ where }),
    db.payroll.groupBy({
      by: ['status'],
      where,
      _sum: { netPay: true },
    }),
    db.payroll.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      skip,
      take: pageSize,
      include: { employee: { select: { employeeCode: true, user: { select: { name: true } } } } },
    }),
  ])

  const totals = {
    draft: Number(totalsAgg.find((t) => t.status === 'DRAFT')?._sum.netPay ?? 0),
    paid: Number(totalsAgg.find((t) => t.status === 'PAID')?._sum.netPay ?? 0),
  }

  const serializedPayslips = payslips.map((p) => ({
    ...p,
    basic: Number(p.basic),
    allowances: Number(p.allowances),
    deductions: Number(p.deductions),
    netPay: Number(p.netPay),
  }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Payroll</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? `${totalCount} payslips · Paid: ${fmtMoney(totals.paid)} · Draft: ${fmtMoney(totals.draft)}` : 'Your payslips'}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {isAdmin && (
            <Button asChild variant="outline" size="sm">
              <a href="/api/export/payroll" download>
                <Download className="h-4 w-4 mr-1" /> Export CSV
              </a>
            </Button>
          )}
          {isAdmin && <GeneratePayrollButton />}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                <tr>
                  {isAdmin && <th className="p-3 font-medium">Employee</th>}
                  <th className="p-3 font-medium">Period</th>
                  <th className="p-3 font-medium text-right">Basic</th>
                  <th className="p-3 font-medium text-right">Allowances</th>
                  <th className="p-3 font-medium text-right">Deductions</th>
                  <th className="p-3 font-medium text-right">Net Pay</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {serializedPayslips.map((p) => {
                  const canViewSlip = isAdmin || (employeeId && employeeId === p.employeeId)
                  return (
                    <tr key={p.id} className="border-t hover:bg-muted/40">
                      {isAdmin && <td className="p-3"><div className="font-medium">{p.employee.user.name}</div><div className="text-xs text-muted-foreground">{p.employee.employeeCode}</div></td>}
                      <td className="p-3 whitespace-nowrap font-medium">{MONTHS[p.month - 1]} {p.year}</td>
                      <td className="p-3 text-right">{fmtMoney(p.basic)}</td>
                      <td className="p-3 text-right text-emerald-700">+{fmtMoney(p.allowances)}</td>
                      <td className="p-3 text-right text-red-600">−{fmtMoney(p.deductions)}</td>
                      <td className="p-3 text-right font-bold">{fmtMoney(p.netPay)}</td>
                      <td className="p-3">{statusBadge(p.status)}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {canViewSlip && (
                            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                              <Link href={`/payroll/${p.id}/slip`}>
                                Payslip
                              </Link>
                            </Button>
                          )}
                          {isAdmin && <PayrollRowActions id={p.id} status={p.status} basic={p.basic} allowances={p.allowances} deductions={p.deductions} />}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!payslips.length && (
                  <tr><td colSpan={8} className="p-10 text-center text-muted-foreground"><Wallet className="h-8 w-8 mx-auto mb-2 opacity-40" />No payslips yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls page={page} pageSize={pageSize} total={totalCount} baseUrl="/payroll" />
        </CardContent>
      </Card>
    </div>
  )
}
