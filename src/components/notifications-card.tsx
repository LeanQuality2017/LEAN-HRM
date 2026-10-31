'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bell, CheckCheck } from 'lucide-react'
import { fmtDate } from '@/lib/constants'

export interface NotifItem { id: string; title: string; message: string | null; link: string | null; isRead: boolean; createdAt: string | Date }

export function NotificationsCard({ items }: { items: NotifItem[] }) {
  const router = useRouter()
  const unread = items.filter((n) => !n.isRead)

  async function markAll() {
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) })
    router.refresh()
  }

  return (
    <Card id="notifications">
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Bell className="h-4 w-4 text-teal-700" /> Notifications
          {unread.length > 0 && <span className="text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5">{unread.length}</span>}
        </CardTitle>
        {unread.length > 0 && (
          <Button variant="ghost" size="sm" onClick={markAll}><CheckCheck className="h-4 w-4 mr-1" /> Mark all read</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 max-h-72 overflow-y-auto">
        {items.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No notifications yet.</p>}
        {items.map((n) => (
          <div key={n.id} className={`rounded-md border p-2.5 text-sm ${n.isRead ? 'opacity-60' : 'border-teal-200 bg-teal-50/50'}`}>
            <div className="font-medium">{n.title}</div>
            {n.message && <div className="text-muted-foreground text-xs mt-0.5">{n.message}</div>}
            <div className="text-[10px] text-muted-foreground mt-1">{fmtDate(n.createdAt)}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
