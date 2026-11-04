'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { UserPlus, UserCheck, Edit2, Trash2, Loader2 } from 'lucide-react'

interface EmployeeOption {
  id: string
  employeeCode: string
  designation: string
  user: {
    name: string
    email: string
  }
}

interface AssignedEmployee {
  assignmentId: string
  employeeId: string
  employeeCode: string
  name: string
  email: string
  designation: string
  isPrimary: boolean
  status: string
}

export function CompanyActionButtons({
  companyId,
  companyCode,
  isSuperAdmin,
  availableEmployees,
}: {
  companyId: string
  companyCode: string
  isSuperAdmin: boolean
  availableEmployees: EmployeeOption[]
}) {
  const router = useRouter()
  const [assignOpen, setAssignOpen] = useState(false)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  // Assign form state
  const [selectedEmpId, setSelectedEmpId] = useState('')
  const [assignDesignation, setAssignDesignation] = useState('')
  const [assignIsPrimary, setAssignIsPrimary] = useState(false)

  // Create user form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(isSuperAdmin ? 'COMPANY_ADMIN' : 'EMPLOYEE')
  const [password, setPassword] = useState('Password@123')
  const [employeeCode, setEmployeeCode] = useState('')
  const [designation, setDesignation] = useState('')
  const [baseSalary, setBaseSalary] = useState('50000')

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedEmpId) {
      toast({ title: 'Validation error', description: 'Please select an employee.', variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmpId,
          companyId,
          designation: assignDesignation || undefined,
          isPrimary: assignIsPrimary,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to assign employee')
      }

      toast({ title: 'Success', description: 'Employee assigned successfully.' })
      setAssignOpen(false)
      setSelectedEmpId('')
      setAssignDesignation('')
      setAssignIsPrimary(false)
      router.refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error assigning employee'
      toast({ title: 'Error', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast({ title: 'Error', description: 'Enter a valid email address.', variant: 'destructive' })
      return
    }
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      toast({ title: 'Error', description: 'Password must be 8+ characters with at least one letter and one digit.', variant: 'destructive' })
      return
    }
    if (baseSalary && Number(baseSalary) > 9999999999.99) {
      toast({ title: 'Error', description: 'Salary cannot exceed 9,999,999,999.99', variant: 'destructive' })
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          role,
          password,
          companyId,
          employeeCode: employeeCode || undefined,
          designation: designation || undefined,
          baseSalary: baseSalary ? Number(baseSalary) : undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to provision user')
      }

      toast({ title: 'Success', description: `User ${name} created and assigned successfully.` })
      setCreateUserOpen(false)
      setName('')
      setEmail('')
      setEmployeeCode('')
      setDesignation('')
      router.refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error provisioning user'
      toast({ title: 'Error', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setAssignOpen(true)}
        className="text-xs"
      >
        <UserCheck className="h-3.5 w-3.5 mr-1" />
        Assign Employee
      </Button>

      <Button
        size="sm"
        onClick={() => setCreateUserOpen(true)}
        className="bg-teal-700 hover:bg-teal-800 text-xs"
      >
        <UserPlus className="h-3.5 w-3.5 mr-1" />
        Provision User
      </Button>

      {/* Assign Employee Modal */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Employee to Company</DialogTitle>
            <DialogDescription>
              Select an employee from the group to grant company assignment.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAssign} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="employee">Select Employee</Label>
              <select
                id="employee"
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={selectedEmpId}
                onChange={(e) => {
                  setSelectedEmpId(e.target.value)
                  const match = availableEmployees.find((emp) => emp.id === e.target.value)
                  if (match && !assignDesignation) {
                    setAssignDesignation(match.designation)
                  }
                }}
                required
              >
                <option value="">-- Choose employee --</option>
                {availableEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employeeCode} - {emp.user.name} ({emp.designation})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="designation">Company Designation</Label>
              <Input
                id="designation"
                placeholder="e.g. Senior Developer"
                value={assignDesignation}
                onChange={(e) => setAssignDesignation(e.target.value)}
              />
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <input
                type="checkbox"
                id="isPrimary"
                className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                checked={assignIsPrimary}
                onChange={(e) => setAssignIsPrimary(e.target.checked)}
              />
              <Label htmlFor="isPrimary" className="text-xs font-normal cursor-pointer">
                Set as Primary Company for this employee
              </Label>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setAssignOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-700 hover:bg-teal-800" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Assignment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Provision User Modal */}
      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Provision New User</DialogTitle>
            <DialogDescription>
              Create user credentials and link employee assignment in a single transaction.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="new-name" className="text-xs">Full Name</Label>
                <Input
                  id="new-name"
                  placeholder="e.g. Alex Morgan"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-role" className="text-xs">Role</Label>
                <select
                  id="new-role"
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  required
                >
                  {isSuperAdmin && <option value="COMPANY_ADMIN">Company Admin</option>}
                  <option value="HR">HR</option>
                  <option value="MANAGER">Manager</option>
                  <option value="EMPLOYEE">Employee</option>
                  {isSuperAdmin && <option value="STUDENT">Student</option>}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="new-email" className="text-xs">Login Email</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="name@unihr.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="new-password" className="text-xs">Initial Password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {role !== 'STUDENT' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="new-code" className="text-xs">Employee Code (optional)</Label>
                    <Input
                      id="new-code"
                      placeholder={`e.g. ${companyCode}-E010`}
                      value={employeeCode}
                      onChange={(e) => setEmployeeCode(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-desig" className="text-xs">Designation</Label>
                    <Input
                      id="new-desig"
                      placeholder="e.g. Software Engineer"
                      value={designation}
                      onChange={(e) => setDesignation(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="new-salary" className="text-xs">Monthly Base Salary</Label>
                  <Input
                    id="new-salary"
                    type="number"
                    value={baseSalary}
                    onChange={(e) => setBaseSalary(e.target.value)}
                  />
                </div>
              </>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setCreateUserOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-700 hover:bg-teal-800" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Provision User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function AssignmentRowActions({
  assignment,
  companyId,
}: {
  assignment: AssignedEmployee
  companyId: string
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [designation, setDesignation] = useState(assignment.designation)
  const [isPrimary, setIsPrimary] = useState(assignment.isPrimary)

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assignment.assignmentId,
          designation,
          isPrimary,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update assignment')

      toast({ title: 'Success', description: 'Assignment updated.' })
      setEditOpen(false)
      router.refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error updating'
      toast({ title: 'Error', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function handleUnassign() {
    if (!confirm(`Are you sure you want to unassign ${assignment.name} from this company?`)) {
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/assignments?id=${assignment.assignmentId}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to unassign employee')

      toast({ title: 'Success', description: 'Employee unassigned.' })
      router.refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error unassigning'
      toast({ title: 'Error', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-1 justify-end">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={() => setEditOpen(true)}
        title="Edit Assignment"
      >
        <Edit2 className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-red-600"
        onClick={handleUnassign}
        disabled={loading}
        title="Unassign Employee"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Assignment</DialogTitle>
            <DialogDescription>
              Update company designation and primary company status for {assignment.name}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-desig">Designation</Label>
              <Input
                id="edit-desig"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                required
              />
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <input
                type="checkbox"
                id="edit-isPrimary"
                className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
              />
              <Label htmlFor="edit-isPrimary" className="text-xs font-normal cursor-pointer">
                Set as Primary Company
              </Label>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-700 hover:bg-teal-800" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
