'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { Check, X, Loader2 } from 'lucide-react'

export function ReviewButtons({ id }: { id: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState<'APPROVED' | 'REJECTED' | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [comment, setComment] = useState('')

  async function act(status: 'APPROVED' | 'REJECTED', withComment?: string) {
    setLoading(status)
    const res = await fetch(`/api/leaves/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, comment: withComment ?? '' }),
    })
    const json = await res.json()
    setLoading(null)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: status === 'APPROVED' ? '✅ Leave approved' : 'Leave rejected' })
    setRejectOpen(false)
    router.refresh()
  }

  return (
    <div className="flex gap-1">
      <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading !== null} onClick={() => act('APPROVED')}>
        {loading === 'APPROVED' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </Button>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-200" disabled={loading !== null}>
            {loading === 'REJECTED' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Reject Leave</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Reason (sent to employee)</Label>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why is this rejected?" />
            </div>
            <Button onClick={() => act('REJECTED', comment)} disabled={loading !== null} className="w-full bg-red-600 hover:bg-red-700">Confirm Reject</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
