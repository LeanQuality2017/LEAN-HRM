'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { Loader2, Plus, Building2 } from 'lucide-react'

export function AddCompanyButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', code: '', type: 'NORMAL', address: '', phone: '', email: '',
    adminEmail: '', adminPassword: '',
  })

  async function submit() {
    if (!form.name || !form.code) return toast({ title: 'Name & code required', variant: 'destructive' })
    if (form.adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail.trim())) {
      return toast({ title: 'Error', description: 'Enter a valid email address.', variant: 'destructive' })
    }
    if (form.adminPassword) {
      if (form.adminPassword.length < 8 || !/[a-zA-Z]/.test(form.adminPassword) || !/\d/.test(form.adminPassword)) {
        return toast({ title: 'Error', description: 'Password must be 8+ characters with at least one letter and one digit.', variant: 'destructive' })
      }
    }
    setLoading(true)
    const res = await fetch('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Company onboarded', description: 'Default leave types were created automatically.' })
    setOpen(false)
    setForm({ name: '', code: '', type: 'NORMAL', address: '', phone: '', email: '', adminEmail: '', adminPassword: '' })
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800"><Plus className="h-4 w-4 mr-1.5" /> Add Company</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Onboard New Company</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Company Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Code *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="GAMMA" /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NORMAL">Normal Company</SelectItem>
                <SelectItem value="INSTITUTE">Training & Placement Institute</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div className="rounded-md border p-3 space-y-2.5">
            <p className="text-xs font-medium text-muted-foreground">Company Admin account (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Admin Email</Label><Input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Admin Password</Label><Input value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} /></div>
            </div>
          </div>
          <Button onClick={submit} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Create Company
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ToggleCompanyButton({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  async function toggle() {
    setLoading(true)
    await fetch(`/api/companies?id=${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !isActive }) })
    setLoading(false)
    toast({ title: isActive ? 'Company disabled' : 'Company enabled' })
    router.refresh()
  }
  return (
    <Button size="sm" variant={isActive ? 'outline' : 'default'} className="h-7 text-xs" disabled={loading} onClick={toggle}>
      <Building2 className="h-3 w-3 mr-1" /> {isActive ? 'Disable' : 'Enable'}
    </Button>
  )
}


export function DeleteCompanyButton({
  id,
  name,
  employeeCount = 0,
}: {
  id: string
  name: string
  employeeCount?: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmName, setConfirmName] = useState('')

  async function handleDelete() {
    if (!email || !password) {
      return toast({ title: 'Error', description: 'Superadmin email and password required.', variant: 'destructive' })
    }
    if (confirmName !== name) {
      return toast({ title: 'Error', description: 'Company name does not match confirmation.', variant: 'destructive' })
    }

    setLoading(true)
    const res = await fetch(`/api/companies/${id}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, confirmName }),
    })
    const json = await res.json().catch(() => ({}))
    setLoading(false)

    if (!res.ok) {
      return toast({ title: 'Delete failed', description: json.error || 'Failed to delete company', variant: 'destructive' })
    }

    toast({ title: '✅ Company permanently deleted', description: `${name} and linked records removed.` })
    setOpen(false)
    setEmail('')
    setPassword('')
    setConfirmName('')
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive" className="h-7 text-xs">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            Delete Company
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-xs space-y-1">
            <p className="font-semibold text-destructive">Warning: This action is permanent and irreversible.</p>
            <p className="text-muted-foreground">
              Company: <span className="font-medium text-foreground">{name}</span>
            </p>
            <p className="text-muted-foreground">
              Linked active employees: <span className="font-medium text-foreground">{employeeCount}</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Superadmin Email *</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="superadmin1@unihr.com"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Superadmin Password *</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Type <span className="font-bold select-all">{name}</span> to confirm *
            </Label>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={name}
              className="h-8 text-xs"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={loading || confirmName !== name || !email || !password}
              className="h-8 text-xs"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
              Confirm Hard Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
