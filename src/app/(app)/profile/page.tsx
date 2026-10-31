import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ProfileForms } from './profile-forms'
import { ROLE_LABELS, fmtDate } from '@/lib/constants'

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      employee: {
        include: {
          assignments: { include: { company: { select: { name: true, code: true } } }, orderBy: { isPrimary: 'desc' } },
          manager: { select: { user: { select: { name: true } } } },
        },
      },
      student: { include: { enrollments: { include: { batch: { include: { course: true } } } } } },
    },
  })

  if (!user) redirect('/login')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">My Profile</h1>
        <p className="text-sm text-muted-foreground">Self-service portal: keep your details up to date</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Account</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-center">
          <Badge className="bg-teal-700">{ROLE_LABELS[user.role]}</Badge>
          {user.employee && <Badge variant="outline">{user.employee.employeeCode}</Badge>}
          {user.employee && user.employee.assignments.map((a) => (
            <Badge key={a.id} variant="outline" className={a.isPrimary ? 'border-teal-600 text-teal-700' : ''}>
              {a.company.code}{a.isPrimary ? ' · primary' : ''}
            </Badge>
          ))}
          {user.student && <Badge variant="outline">{user.student.code}</Badge>}
          <span className="text-xs text-muted-foreground ml-auto">Member since {fmtDate(user.createdAt)}</span>
        </CardContent>
      </Card>

      {user.employee && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Employment Details</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
            <div><span className="text-muted-foreground text-xs block">Designation</span>{user.employee.designation}</div>
            <div><span className="text-muted-foreground text-xs block">Joined</span>{fmtDate(user.employee.joinedAt)}</div>
            <div><span className="text-muted-foreground text-xs block">Reporting Manager</span>{user.employee.manager?.user.name ?? '—'}</div>
          </CardContent>
        </Card>
      )}

      {user.student && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Training Details</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="text-muted-foreground text-xs block mr-2 inline">Status</span>{user.student.status}</div>
            {user.student.enrollments.map((en) => (
              <div key={en.id}><span className="text-muted-foreground text-xs block mr-2 inline">Batch</span>{en.batch.name} ({en.batch.course.name}) · {en.status}</div>
            ))}
          </CardContent>
        </Card>
      )}

      <ProfileForms name={user.name} phone={user.phone ?? ''} email={user.email} />
    </div>
  )
}
