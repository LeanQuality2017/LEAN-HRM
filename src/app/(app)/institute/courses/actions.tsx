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
import { BATCH_STATUSES } from '@/lib/constants'

export function NewCourseButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', code: '', durationWeeks: '8', fee: '', description: '' })

  async function submit() {
    if (!form.name || !form.code) return toast({ title: 'Name & code required', variant: 'destructive' })
    setLoading(true)
    const res = await fetch('/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Course created' })
    setOpen(false)
    setForm({ name: '', code: '', durationWeeks: '8', fee: '', description: '' })
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="bg-teal-700 hover:bg-teal-800"><Plus className="h-4 w-4 mr-1.5" /> New Course</Button></DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>New Course</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Code *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Duration (weeks)</Label><Input type="number" value={form.durationWeeks} onChange={(e) => setForm({ ...form, durationWeeks: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Course Fee (₹)</Label><Input type="number" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <Button onClick={submit} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Create Course
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function NewBatchButton({ courses }: { courses: { id: string; name: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ courseId: '', name: '', startDate: '', endDate: '', capacity: '30', status: 'UPCOMING' })

  async function submit() {
    if (!form.courseId || !form.name || !form.startDate) return toast({ title: 'Course, name & start date required', variant: 'destructive' })
    setLoading(true)
    const res = await fetch('/api/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, endDate: form.endDate || null }) })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Batch created' })
    setOpen(false)
    setForm({ courseId: '', name: '', startDate: '', endDate: '', capacity: '30', status: 'UPCOMING' })
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Plus className="h-4 w-4 mr-1.5" /> New Batch</Button></DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>New Batch</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Course</Label>
            <Select value={form.courseId} onValueChange={(v) => setForm({ ...form, courseId: v })}>
              <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
              <SelectContent>{courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Batch Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="PYFS-2026-Morning" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>End Date</Label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Capacity</Label><Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BATCH_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={submit} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Create Batch
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function BatchStatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  async function change(next: string) {
    const res = await fetch(`/api/batches?id=${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
    if (!res.ok) return toast({ title: 'Error', variant: 'destructive' })
    toast({ title: `Batch → ${next}` })
    router.refresh()
  }
  return (
    <select value={status} onChange={(e) => change(e.target.value)} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs">
      {BATCH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}
