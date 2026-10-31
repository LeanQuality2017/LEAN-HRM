import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/stat-card'
import { RecordFeeButton } from './actions'
import { fmtDate, fmtMoney, HR_ROLES } from '@/lib/constants'
import { ReceiptIndianRupee, IndianRupee, TrendingUp, Download } from 'lucide-react'

export default async function FeesPage() {
  const session = await getServerSession(authOptions)
  const role = session?.user?.role
  const canExport = role && HR_ROLES.includes(role)
  const exportFrom = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  const exportTo = new Date().toISOString().slice(0, 10)
  const exportUrl = `/api/export/fees?from=${exportFrom}&to=${exportTo}`

  const [payments, students] = await Promise.all([
    db.feePayment.findMany({
      orderBy: { paidAt: 'desc' }, take: 300,
      include: { student: { select: { name: true, code: true } }, receivedBy: { select: { name: true } } },
    }),
    db.student.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
  ])

  const totalCollected = payments.reduce((s, p) => s + Number(p.amount), 0)
  const thisMonth = payments.filter((p) => new Date(p.paidAt).getMonth() === new Date().getMonth() && new Date(p.paidAt).getFullYear() === new Date().getFullYear()).reduce((s, p) => s + Number(p.amount), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Fee Collections</h1>
          <p className="text-sm text-muted-foreground">Institute revenue tracking</p>
        </div>
        <div className="flex gap-2 items-center">
          {canExport && (
            <Button asChild variant="outline" size="sm">
              <a href={exportUrl} download>
                <Download className="h-4 w-4 mr-1" /> Export CSV
              </a>
            </Button>
          )}
          <RecordFeeButton students={students} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Total Collected" value={fmtMoney(totalCollected)} icon={IndianRupee} tone="good" />
        <StatCard title="This Month" value={fmtMoney(thisMonth)} icon={TrendingUp} />
        <StatCard title="Transactions" value={payments.length} icon={ReceiptIndianRupee} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                <tr>
                  <th className="p-3 font-medium">Invoice</th>
                  <th className="p-3 font-medium">Student</th>
                  <th className="p-3 font-medium text-right">Amount</th>
                  <th className="p-3 font-medium">Method</th>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium">Note</th>
                  <th className="p-3 font-medium">Received By</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t hover:bg-muted/40">
                    <td className="p-3 font-medium">{p.invoiceNo}</td>
                    <td className="p-3"><div className="font-medium">{p.student.name}</div><div className="text-xs text-muted-foreground">{p.student.code}</div></td>
                    <td className="p-3 text-right font-semibold">{fmtMoney(Number(p.amount))}</td>
                    <td className="p-3"><Badge variant="outline" className="text-[10px]">{p.method}</Badge></td>
                    <td className="p-3 whitespace-nowrap text-xs">{fmtDate(p.paidAt)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{p.note ?? '—'}</td>
                    <td className="p-3 text-xs text-muted-foreground">{p.receivedBy?.name ?? '—'}</td>
                  </tr>
                ))}
                {!payments.length && (
                  <tr><td colSpan={7} className="p-10 text-center text-muted-foreground"><ReceiptIndianRupee className="h-8 w-8 mx-auto mb-2 opacity-40" />No payments recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
