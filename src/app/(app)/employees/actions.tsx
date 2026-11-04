'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { Loader2, Plus, Pencil } from 'lucide-react'
import { ROLES, ROLE_LABELS } from '@/lib/constants'

interface CompanyOpt { id: string; name: string; code: string }
interface EmpOpt { id: string; name: string; code: string }

export function AddEmployeeButton({ companies, managers }: { companies: CompanyOpt[]; managers: EmpOpt[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [companyIds, setCompanyIds] = useState<string[]>([])
  const [form, setForm] = useState({
    name: '', email: '', password: '', employeeCode: '', role: 'EMPLOYEE',
    designation: '', baseSalary: '', managerId: '', joinedAt: new Date().toISOString().slice(0, 10), phone: '',
  })

  function toggleCompany(id: string) {
    setCompanyIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  async function submit() {
    if (!form.name || !form.email || !form.password || !form.employeeCode || !companyIds.length) {
      return toast({ title: 'Missing fields', description: 'Name, email, password, employee code and at least one company are required.', variant: 'destructive' })
    }
    if (!form.designation.trim()) {
      return toast({ title: 'Error', description: 'Designation is required.', variant: 'destructive' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return toast({ title: 'Error', description: 'Enter a valid email address.', variant: 'destructive' })
    }
    if (form.password.length < 8 || !/[a-zA-Z]/.test(form.password) || !/\d/.test(form.password)) {
      return toast({ title: 'Error', description: 'Password must be 8+ characters with at least one letter and one digit.', variant: 'destructive' })
    }
    if (Number(form.baseSalary) > 9999999999.99) {
      return toast({ title: 'Error', description: 'Salary cannot exceed 9,999,999,999.99', variant: 'destructive' })
    }
    setLoading(true)
    const res = await fetch('/api/employees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, baseSalary: Number(form.baseSalary) || 0, companyId: companyIds[0], companyIds, managerId: form.managerId || null }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Employee created', description: `${form.name} can now log in with ${form.email}` })
    setOpen(false)
    setCompanyIds([])
    setForm({ ...form, name: '', email: '', password: '', employeeCode: '', designation: '', baseSalary: '', phone: '' })
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800"><Plus className="h-4 w-4 mr-1.5" /> Add Employee</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Employee (with login)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Employee Code *</Label><Input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} placeholder="ALPHA-E003" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Email (login) *</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Password *</Label><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min 6 chars" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(ROLES).filter((r) => r !== 'SUPER_ADMIN').map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Designation</Label><Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Base Salary (₹)</Label><Input type="number" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Companies * <span className="text-xs text-muted-foreground">(works across group; first = primary)</span></Label>
            <div className="flex flex-wrap gap-2">
              {companies.map((c) => (
                <button
                  key={c.id} type="button" onClick={() => toggleCompany(c.id)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${companyIds.includes(c.id) ? 'bg-teal-700 text-white border-teal-700' : 'bg-background hover:bg-muted'}`}
                >
                  {c.code} <span className="opacity-70">{companyIds.indexOf(c.id) === 0 ? '· primary' : ''}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Reporting Manager</Label>
              <Select value={form.managerId} onValueChange={(v) => setForm({ ...form, managerId: v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.code} · {m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Joined At</Label><Input type="date" value={form.joinedAt} onChange={(e) => setForm({ ...form, joinedAt: e.target.value })} /></div>
          </div>
          <Button onClick={submit} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Create Employee
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function EditEmployeeButton({ employee, companies }: {
  employee: {
    id: string; name: string; phone: string | null; role: string; designation: string;
    baseSalary: number; status: string; companyIds: string[];
  }
  companies: CompanyOpt[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [companyIds, setCompanyIds] = useState<string[]>(employee.companyIds)
  const [form, setForm] = useState({
    name: employee.name, phone: employee.phone ?? '', role: employee.role,
    designation: employee.designation, baseSalary: String(employee.baseSalary), status: employee.status, password: '',
  })

  function toggleCompany(id: string) {
    setCompanyIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  async function submit() {
    if (!form.name.trim()) {
      return toast({ title: 'Error', description: 'Name is required', variant: 'destructive' })
    }
    if (!form.designation.trim()) {
      return toast({ title: 'Error', description: 'Designation is required.', variant: 'destructive' })
    }
    if (!companyIds.length) return toast({ title: 'Select at least one company', variant: 'destructive' })
    if (Number(form.baseSalary) > 9999999999.99) {
      return toast({ title: 'Error', description: 'Salary cannot exceed 9,999,999,999.99', variant: 'destructive' })
    }
    if (form.password && (form.password.length < 8 || !/[a-zA-Z]/.test(form.password) || !/\d/.test(form.password))) {
      return toast({ title: 'Error', description: 'Password must be 8+ characters with at least one letter and one digit.', variant: 'destructive' })
    }
    setLoading(true)
    const res = await fetch(`/api/employees?id=${employee.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, baseSalary: Number(form.baseSalary) || 0, companyIds, password: form.password || undefined }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) return toast({ title: 'Error', description: json.error, variant: 'destructive' })
    toast({ title: '✅ Employee updated' })
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Edit employee"><Pencil className="h-3.5 w-3.5" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Employee</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(ROLES).filter((r) => r !== 'SUPER_ADMIN').map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ACTIVE">ACTIVE</SelectItem><SelectItem value="INACTIVE">INACTIVE</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Designation</Label><Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Base Salary (₹)</Label><Input type="number" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Companies</Label>
            <div className="flex flex-wrap gap-2">
              {companies.map((c) => (
                <button
                  key={c.id} type="button" onClick={() => toggleCompany(c.id)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${companyIds.includes(c.id) ? 'bg-teal-700 text-white border-teal-700' : 'bg-background hover:bg-muted'}`}
                >
                  {c.code}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reset Password</Label>
            <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to keep current" />
          </div>
          <Button onClick={submit} disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
