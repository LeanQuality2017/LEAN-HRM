'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { Plus, Loader2 } from 'lucide-react'

export function SubmitReportButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), tasks: '', hoursWorked: '8', blockers: '' })

  async function submit() {
    if (!form.tasks) return toast({ title: 'Tasks required', variant: 'destructive' })
    setLoading(true)
    const res = await fetch('/api/work-reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, hoursWorked: Number(form.hoursWorked) || 8 }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Report submitted', description: 'Your manager will review it.' })
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800"><Plus className="h-4 w-4 mr-1.5" /> Submit EOD Report</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Daily Work Report</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Hours Worked</Label>
              <Input type="number" min="1" max="16" step="0.5" value={form.hoursWorked} onChange={(e) => setForm({ ...form, hoursWorked: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>What did you work on today?</Label>
            <Textarea value={form.tasks} onChange={(e) => setForm({ ...form, tasks: e.target.value })} rows={4} placeholder="Tasks completed, progress, meetings attended..." />
          </div>
          <div className="space-y-1.5">
            <Label>Blockers (optional)</Label>
            <Input value={form.blockers} onChange={(e) => setForm({ ...form, blockers: e.target.value })} placeholder="Anything blocking you?" />
          </div>
          <Button onClick={submit} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Submit Report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
