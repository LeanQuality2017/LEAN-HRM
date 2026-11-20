'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { Plus, Loader2, AlertCircle } from 'lucide-react'

export interface LeaveTypeOption {
  id: string
  name: string
  isUnpaid?: boolean
  available?: number
}

export function ApplyLeaveButton({ leaveTypes }: { leaveTypes: LeaveTypeOption[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ leaveTypeId: '', startDate: '', endDate: '', reason: '' })

  const selectedType = leaveTypes.find((lt) => lt.id === form.leaveTypeId)
  const available = selectedType?.available ?? 0
  const isUnpaid = selectedType?.isUnpaid ?? false

  let requestedDays = 0
  if (form.startDate && form.endDate) {
    const s = new Date(form.startDate)
    const e = new Date(form.endDate)
    s.setHours(0, 0, 0, 0)
    e.setHours(0, 0, 0, 0)
    if (e >= s) {
      requestedDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
    }
  }

  const isOverdrawn = Boolean(!isUnpaid && form.leaveTypeId && requestedDays > available)

  async function submit() {
    if (!form.leaveTypeId || !form.startDate || !form.endDate || !form.reason) {
      return toast({ title: 'Missing fields', description: 'Fill all fields before submitting.', variant: 'destructive' })
    }
    if (isOverdrawn) {
      return toast({
        title: 'Insufficient Balance',
        description: `Available ${available} days, you requested ${requestedDays}`,
        variant: 'destructive',
      })
    }
    setLoading(true)
    const res = await fetch('/api/leaves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Leave applied', description: 'Sent for approval.' })
    setOpen(false)
    setForm({ leaveTypeId: '', startDate: '', endDate: '', reason: '' })
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800"><Plus className="h-4 w-4 mr-1.5" /> Apply Leave</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Apply for Leave</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Leave Type</Label>
              {selectedType && (
                <span className="text-xs text-muted-foreground font-medium">
                  {isUnpaid ? 'LOP / Unpaid' : `Available: ${available} day(s)`}
                </span>
              )}
            </div>
            <Select value={form.leaveTypeId} onValueChange={(v) => setForm({ ...form, leaveTypeId: v })}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {leaveTypes.map((lt) => (
                  <SelectItem key={lt.id} value={lt.id}>
                    {lt.name} {lt.isUnpaid ? '(Unpaid)' : `(${lt.available ?? 0} available)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>From</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>To</Label>
              <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
          {requestedDays > 0 && (
            <div className="text-xs text-muted-foreground">
              Requested: <span className="font-semibold text-foreground">{requestedDays}</span> day(s)
            </div>
          )}
          {isOverdrawn && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>Available {available} days, you requested {requestedDays}</span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason for leave" rows={3} />
          </div>
          <Button onClick={submit} disabled={loading || isOverdrawn} className="w-full bg-teal-700 hover:bg-teal-800 disabled:opacity-50">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Submit Application
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
