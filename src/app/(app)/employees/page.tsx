import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AddEmployeeButton, EditEmployeeButton } from './actions'
import { fmtDate, fmtMoney, ROLE_LABELS } from '@/lib/constants'
import { Users } from 'lucide-react'

export default async function EmployeesPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')
  const role = session.user.role
  const sp = searchParams ? await searchParams : {}
  const q = sp.q?.trim()

  const companies = await db.company.findMany({ select: { id: true, name: true, code: true }, orderBy: { createdAt: 'asc' } })
  const employees = await db.employee.findMany({
    where: q
      ? {
          OR: [
            { employeeCode: { contains: q, mode: 'insensitive' } },
            { designation: { contains: q, mode: 'insensitive' } },
            { user: { name: { contains: q, mode: 'insensitive' } } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {},
    orderBy: { employeeCode: 'asc' },
    include: {
      user: { select: { name: true, email: true, phone: true, role: true, isActive: true } },
      assignments: { include: { company: { select: { code: true } } }, orderBy: { isPrimary: 'desc' } },
      manager: { select: { employeeCode: true, user: { select: { name: true } } } },
      _count: { select: { directReports: true } },
    },
  })
  const managers = employees.filter((e) => ['MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(e.user.role)).map((e) => ({ id: e.id, name: e.user.name, code: e.employeeCode }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Employees</h1>
          <p className="text-sm text-muted-foreground">{employees.length} employees · shared employees work across companies</p>
        </div>
        <AddEmployeeButton companies={companies} managers={managers} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                <tr>
                  <th className="p-3 font-medium">Employee</th>
                  <th className="p-3 font-medium">Role</th>
                  <th className="p-3 font-medium">Companies</th>
                  <th className="p-3 font-medium">Designation</th>
                  <th className="p-3 font-medium text-right">Salary</th>
                  <th className="p-3 font-medium">Manager</th>
                  <th className="p-3 font-medium">Joined</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-t hover:bg-muted/40">
                    <td className="p-3">
                      <div className="font-medium">{e.user.name}</div>
                      <div className="text-xs text-muted-foreground">{e.employeeCode} · {e.user.email}</div>
                    </td>
                    <td className="p-3"><Badge variant="outline" className="text-[10px]">{ROLE_LABELS[e.user.role] ?? e.user.role}</Badge></td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {e.assignments.map((a) => (
                          <Badge key={a.id} variant="outline" className={`text-[10px] ${a.isPrimary ? 'border-teal-600 text-teal-700' : ''}`}>{a.company.code}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">{e.designation}</td>
                    <td className="p-3 text-right">{fmtMoney(Number(e.baseSalary))}</td>
                    <td className="p-3 text-xs">{e.manager ? e.manager.user.name : '—'}</td>
                    <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(e.joinedAt)}</td>
                    <td className="p-3">
                      <Badge className={`text-[10px] border-0 ${e.status === 'ACTIVE' && e.user.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                        {e.user.isActive ? e.status : 'LOGIN DISABLED'}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <EditEmployeeButton
                        companies={companies}
                        employee={{
                          id: e.id, name: e.user.name, phone: e.user.phone, role: e.user.role,
                          designation: e.designation, baseSalary: Number(e.baseSalary), status: e.status,
                          companyIds: e.assignments.map((a) => a.companyId),
                        }}
                      />
                    </td>
                  </tr>
                ))}
                {!employees.length && (
                  <tr><td colSpan={9} className="p-10 text-center text-muted-foreground"><Users className="h-8 w-8 mx-auto mb-2 opacity-40" />No employees yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
