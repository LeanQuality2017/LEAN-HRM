'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LogIn, LogOut, Loader2, CalendarCheck } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { fmtTime } from '@/lib/constants'

export function AttendanceWidget({ checkIn, checkOut }: { checkIn: string | null; checkOut: string | null }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function toggle() {
    setLoading(true)
    const res = await fetch('/api/attendance', { method: 'POST' })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) {
      toast({ title: 'Error', description: json.error ?? 'Something went wrong', variant: 'destructive' })
      return
    }
    toast({ title: json.action === 'CHECK_IN' ? '✅ Checked in' : '✅ Checked out', description: fmtTime(json.attendance?.checkIn ?? json.attendance?.checkOut) })
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2"><CalendarCheck className="h-4 w-4 text-teal-700" /> Today&apos;s Attendance</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-6 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Check-in</div>
            <div className="font-semibold">{fmtTime(checkIn)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Check-out</div>
            <div className="font-semibold">{fmtTime(checkOut)}</div>
          </div>
        </div>
        <Button onClick={toggle} disabled={loading || (checkIn !== null && checkOut !== null)} className="bg-teal-700 hover:bg-teal-800">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : checkIn ? <LogOut className="h-4 w-4 mr-2" /> : <LogIn className="h-4 w-4 mr-2" />}
          {!checkIn ? 'Check In' : !checkOut ? 'Check Out' : 'Done for today'}
        </Button>
      </CardContent>
    </Card>
  )
}
