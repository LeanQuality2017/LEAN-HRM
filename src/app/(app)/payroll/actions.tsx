'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { Loader2, Wallet, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function GeneratePayrollButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth())
  const [year, setYear] = useState(now.getFullYear())

  const [skippedList, setSkippedList] = useState<
    Array<{ employeeId: string; employeeCode: string; employeeName: string; reason: string }>
  >([])

  async function generate() {
    setLoading(true)
    setSkippedList([])
    const res = await fetch('/api/payroll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, year }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })

    const skipped = Array.isArray(json.data?.skipped) ? json.data.skipped : []
    if (skipped.length > 0) {
      setSkippedList(skipped)
      toast({
        title: '⚠️ Payroll generated with warnings',
        description: `${json.data.created} payslips created, ${skipped.length} employees skipped.`,
        variant: 'destructive',
      })
    } else {
      toast({
        title: '✅ Payroll generated',
        description: `${json.data.created} payslips created.`,
      })
      setOpen(false)
    }
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800"><Wallet className="h-4 w-4 mr-1.5" /> Generate Payroll</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader><DialogTitle>Generate Payroll Batch</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Creates DRAFT payslips for all active employees (basic + 12% allowances − 5% deductions). Existing payslips are skipped.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Month</Label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Year</Label>
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
        </div>
        <Button onClick={generate} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
          {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Generate
        </Button>

        {skippedList.length > 0 && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-900 text-xs space-y-2">
            <div className="font-semibold flex items-center gap-1.5 text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {skippedList.length} employee(s) skipped due to calculation errors:
            </div>
            <ul className="divide-y divide-amber-200/60 max-h-40 overflow-y-auto">
              {skippedList.map((s) => (
                <li key={s.employeeId} className="py-1.5 flex items-center justify-between gap-2">
                  <div className="truncate">
                    <span className="font-medium">{s.employeeCode}</span> ({s.employeeName}): {s.reason}
                  </div>
                  <Link
                    href={`/employees/${s.employeeId}`}
                    className="text-teal-700 underline font-medium hover:text-teal-800 shrink-0"
                  >
                    Fix Profile
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-amber-700">Fix their statutory profile, then re-run payroll generation.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function PayrollRowActions({ id, status, basic, allowances, deductions }: { id: string; status: string; basic: number; allowances: number; deductions: number }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ basic: String(basic), allowances: String(allowances), deductions: String(deductions) })

  async function save(nextStatus?: string) {
    setLoading(true)
    const res = await fetch(`/api/payroll?id=${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        basic: Number(form.basic), allowances: Number(form.allowances), deductions: Number(form.deductions),
        ...(nextStatus ? { status: nextStatus } : {}),
      }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: nextStatus === 'PAID' ? '✅ Marked as paid' : 'Payslip updated' })
    setOpen(false)
    router.refresh()
  }

  if (status === 'PAID') return <span className="text-xs text-muted-foreground">—</span>

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7">Edit / Pay</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader><DialogTitle>Update Payslip</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {(['basic', 'allowances', 'deductions'] as const).map((f) => (
            <div key={f} className="space-y-1.5">
              <Label className="capitalize">{f}</Label>
              <Input type="number" value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} disabled={status === 'PAID'} />
            </div>
          ))}
          <div className="flex gap-2">
            <Button onClick={() => save()} disabled={loading} variant="outline" className="flex-1">Save Draft</Button>
            {status === 'DRAFT' && <Button onClick={() => save('PROCESSED')} disabled={loading} className="flex-1 bg-teal-700 hover:bg-teal-800">Process</Button>}
            {status !== 'DRAFT' && <Button onClick={() => save('PAID')} disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-700">Mark Paid</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
