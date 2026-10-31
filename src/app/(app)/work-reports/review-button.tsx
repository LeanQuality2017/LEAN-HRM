'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { MessageSquare, Loader2 } from 'lucide-react'

export function ReviewReportButton({ id, existing }: { id: string; existing?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [comment, setComment] = useState('')

  async function submit() {
    if (!comment.trim()) return toast({ title: 'Comment required', variant: 'destructive' })
    setLoading(true)
    const res = await fetch(`/api/work-reports/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Review posted', description: 'Employee has been notified.' })
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7"><MessageSquare className="h-3.5 w-3.5 mr-1" /> Review</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Review Work Report</DialogTitle></DialogHeader>
        {existing && <p className="text-xs text-muted-foreground">Previous comment: “{existing}”</p>}
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} placeholder="Feedback on today's work..." />
        <Button onClick={submit} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
          {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Post Review
        </Button>
      </DialogContent>
    </Dialog>
  )
}
