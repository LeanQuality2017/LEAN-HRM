'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { Loader2, Plus, ClipboardEdit } from 'lucide-react'

export function NewAssessmentButton({ batches }: { batches: { id: string; name: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ batchId: '', title: '', date: new Date().toISOString().slice(0, 10), maxScore: '100' })

  async function submit() {
    if (!form.batchId || !form.title) return toast({ title: 'Batch & title required', variant: 'destructive' })
    setLoading(true)
    const res = await fetch('/api/assessments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Assessment created' })
    setOpen(false)
    setForm({ batchId: '', title: '', date: new Date().toISOString().slice(0, 10), maxScore: '100' })
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="bg-teal-700 hover:bg-teal-800"><Plus className="h-4 w-4 mr-1.5" /> New Assessment</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader><DialogTitle>New Assessment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Batch</Label>
            <Select value={form.batchId} onValueChange={(v) => setForm({ ...form, batchId: v })}>
              <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
              <SelectContent>{batches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Max Score</Label><Input type="number" value={form.maxScore} onChange={(e) => setForm({ ...form, maxScore: e.target.value })} /></div>
          </div>
          <Button onClick={submit} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function EnterResultsButton({ assessment, students }: {
  assessment: { id: string; title: string; maxScore: number }
  students: { id: string; name: string; code: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [scores, setScores] = useState<Record<string, string>>({})

  async function submit() {
    setLoading(true)
    const results = Object.entries(scores)
      .filter(([, v]) => v !== '')
      .map(([studentId, score]) => ({ studentId, score: Number(score) }))
    const res = await fetch(`/api/assessments?id=${assessment.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }),
    })
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', variant: 'destructive' })
    toast({ title: '✅ Results saved' })
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7"><ClipboardEdit className="h-3.5 w-3.5 mr-1" /> Enter Results</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Results: {assessment.title} <span className="text-muted-foreground font-normal">(max {assessment.maxScore})</span></DialogTitle></DialogHeader>
        <div className="space-y-2">
          {students.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="text-sm flex-1 truncate">{s.name} <span className="text-xs text-muted-foreground">{s.code}</span></span>
              <Input
                type="number" className="w-20 h-8" min="0" max={assessment.maxScore}
                value={scores[s.id] ?? ''} onChange={(e) => setScores({ ...scores, [s.id]: e.target.value })}
              />
            </div>
          ))}
          {!students.length && <p className="text-sm text-muted-foreground text-center py-2">No students enrolled in this batch.</p>}
          <Button onClick={submit} disabled={loading || !students.length} className="w-full bg-teal-700 hover:bg-teal-800">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Save Results
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
