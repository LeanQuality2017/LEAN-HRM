'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { Loader2, Save, KeyRound, LogOut } from 'lucide-react'

export function ProfileForms({ name, phone, email }: { name: string; phone: string; email: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState({ name, phone })
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })

  async function saveInfo() {
    setLoading(true)
    const res = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(info) })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: 'Profile updated' })
    router.refresh()
  }

  async function changePassword() {
    if (!pwd.currentPassword || !pwd.newPassword || !pwd.confirmPassword) {
      return toast({ title: 'All password fields are required', variant: 'destructive' })
    }
    if (pwd.newPassword.length < 8) {
      return toast({ title: 'New password must be at least 8 characters', variant: 'destructive' })
    }
    if (pwd.newPassword !== pwd.confirmPassword) {
      return toast({ title: 'New passwords do not match', variant: 'destructive' })
    }
    setLoading(true)
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: pwd.currentPassword, newPassword: pwd.newPassword }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: 'Password changed successfully', description: 'Please sign in again with your new password.' })
    setPwd({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setTimeout(() => signOut({ callbackUrl: '/login' }), 1200)
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Personal Info</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><Label>Email (login)</Label><Input value={email} disabled /></div>
          <div className="space-y-1.5"><Label>Full Name</Label><Input value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={info.phone} onChange={(e) => setInfo({ ...info, phone: e.target.value })} placeholder="+91 ..." /></div>
          <Button onClick={saveInfo} disabled={loading} className="bg-teal-700 hover:bg-teal-800">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />} Save
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Change Password</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><Label>Current Password</Label><Input type="password" value={pwd.currentPassword} onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })} autoComplete="current-password" /></div>
          <div className="space-y-1.5"><Label>New Password</Label><Input type="password" value={pwd.newPassword} onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })} autoComplete="new-password" placeholder="Min. 8 characters" /></div>
          <div className="space-y-1.5"><Label>Confirm Password</Label><Input type="password" value={pwd.confirmPassword} onChange={(e) => setPwd({ ...pwd, confirmPassword: e.target.value })} autoComplete="new-password" placeholder="Re-enter new password" /></div>
          <Button onClick={changePassword} disabled={loading} variant="outline">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <KeyRound className="h-4 w-4 mr-2" />} Update Password
          </Button>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><LogOut className="h-3 w-3" /> You will be signed out after changing password.</p>
        </CardContent>
      </Card>
    </div>
  )
}
