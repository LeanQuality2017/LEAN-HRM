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
import { Loader2, Plus } from 'lucide-react'

export function NewJobButton({ companies }: { companies: { id: string; name: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ companyId: '', title: '', department: '', openings: '1', description: '' })

  async function submit() {
    if (!form.companyId || !form.title) return toast({ title: 'Company & title required', variant: 'destructive' })
    setLoading(true)
    const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Job opening created' })
    setOpen(false)
    setForm({ companyId: '', title: '', department: '', openings: '1', description: '' })
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800"><Plus className="h-4 w-4 mr-1.5" /> New Job</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>New Job Opening</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Company</Label>
            <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
              <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Job Title</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Senior React Developer" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Openings</Label>
              <Input type="number" min="1" value={form.openings} onChange={(e) => setForm({ ...form, openings: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          </div>
          <Button onClick={submit} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Create Opening
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AddCandidateButton({ jobs }: { jobs: { id: string; title: string; companyCode: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ jobOpeningId: '', name: '', email: '', phone: '', experience: '0', resumeNote: '' })

  async function submit() {
    if (!form.jobOpeningId || !form.name || !form.email) return toast({ title: 'Job, name & email required', variant: 'destructive' })
    setLoading(true)
    const res = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Candidate added to pipeline' })
    setOpen(false)
    setForm({ jobOpeningId: '', name: '', email: '', phone: '', experience: '0', resumeNote: '' })
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus className="h-4 w-4 mr-1.5" /> Add Candidate</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add Candidate</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Applying for</Label>
            <Select value={form.jobOpeningId} onValueChange={(v) => setForm({ ...form, jobOpeningId: v })}>
              <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
              <SelectContent>
                {jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.companyCode} · {j.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Experience (yrs)</Label><Input type="number" step="0.5" value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Resume Summary</Label>
            <Textarea value={form.resumeNote} onChange={(e) => setForm({ ...form, resumeNote: e.target.value })} rows={2} />
          </div>
          <Button onClick={submit} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Add to Pipeline
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const STAGES = ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']

export function CandidateStageSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [value, setValue] = useState(status)

  async function change(next: string) {
    setValue(next)
    setLoading(true)
    const res = await fetch(`/api/applications?id=${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
    setLoading(false)
    if (!res.ok) { setValue(status); return toast({ title: 'Error', variant: 'destructive' }) }
    toast({ title: `Candidate moved to ${next}` })
    router.refresh()
  }

  return (
    <select
      value={value}
      disabled={loading}
      onChange={(e) => change(e.target.value)}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium"
    >
      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

export function JobStatusToggle({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  async function toggle() {
    const next = status === 'OPEN' ? 'CLOSED' : 'OPEN'
    const res = await fetch(`/api/jobs?id=${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
    if (!res.ok) return toast({ title: 'Error', variant: 'destructive' })
    toast({ title: `Job ${next === 'OPEN' ? 'reopened' : 'closed'}` })
    router.refresh()
  }
  return (
    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={toggle}>
      {status === 'OPEN' ? 'Close' : 'Reopen'}
    </Button>
  )
}
