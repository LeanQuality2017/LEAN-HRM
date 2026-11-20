export const dynamic = 'force-dynamic'

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePageAuth } from '@/lib/page-auth'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ApplyLeaveButton } from './apply-button'
import { fmtDate } from '@/lib/constants'
import { CalendarX } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { PaginationControls } from '@/components/pagination-controls'
import {
  computeAvailableBalance,
  getLeaveYear,
  getLeaveYearBoundaries,
} from '@/lib/leave'

function statusBadge(s: string) {
  const map: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800', APPROVED: 'bg-emerald-100 text-emerald-800',
    REJECTED: 'bg-red-100 text-red-800', CANCELLED: 'bg-gray-100 text-gray-700',
  }
  return <Badge className={`${map[s]} text-[10px] border-0`}>{s}</Badge>
}

export default async function LeavesPage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  const auth = await requirePageAuth(['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'])
  const { role, employeeId, administeredCompanyIds, employedCompanyIds } = auth
  const isSuperAdmin = role === 'SUPER_ADMIN'
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER'].includes(role)
  const sp = searchParams ? await searchParams : {}
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const pageSize = 25
  const skip = (page - 1) * pageSize

  const [total, myLeaves] = employeeId
    ? await Promise.all([
        db.leaveRequest.count({ where: { employeeId } }),
        db.leaveRequest.findMany({
          where: { employeeId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: { leaveType: { select: { name: true } }, reviewedBy: { select: { name: true } } },
        }),
      ])
    : [0, []]

  // Leave types: scoped to authorized employment scope for staff self-service;
  // delegated company scope (UserCompanyScope) for administrative views; never fetch all without explicit group-wide authority.
  let leaveTypes: { id: string; name: string; daysPerYear: number; companyId: string; isUnpaid: boolean }[] = []
  if (employeeId && employedCompanyIds.length > 0) {
    leaveTypes = await db.leaveType.findMany({
      where: { companyId: { in: employedCompanyIds } },
    })
  } else if (!employeeId) {
    if (isSuperAdmin) {
      leaveTypes = await db.leaveType.findMany({})
    } else if (administeredCompanyIds && administeredCompanyIds.length > 0) {
      leaveTypes = await db.leaveType.findMany({
        where: { companyId: { in: administeredCompanyIds } },
      })
    }
  }

  // Compute live balances and pending requests for the current leave year
  const currentYear = getLeaveYear(new Date())
  const { yearStart, yearEnd } = getLeaveYearBoundaries(currentYear)

  const [balances, pendingRequests] = employeeId
    ? await Promise.all([
        db.leaveBalance.findMany({
          where: { employeeId, year: currentYear },
        }),
        db.leaveRequest.findMany({
          where: {
            employeeId,
            status: 'PENDING',
            startDate: { gte: yearStart, lte: yearEnd },
          },
          select: { leaveTypeId: true, days: true },
        }),
      ])
    : [[], []]

  const balanceCards = leaveTypes.map((lt) => {
    const bal = balances.find((b) => b.leaveTypeId === lt.id)
    const pendingDec = pendingRequests
      .filter((r) => r.leaveTypeId === lt.id)
      .reduce(
        (sum, r) => sum.add(new Prisma.Decimal(r.days.toString())),
        new Prisma.Decimal('0.00')
      )

    const credited = bal ? bal.credited.toNumber() : 0
    const carried = bal ? bal.carriedForward.toNumber() : 0
    const used = bal ? bal.used.toNumber() : 0

    const available = lt.isUnpaid
      ? 0
      : computeAvailableBalance({
          credited,
          carriedForward: carried,
          used,
          pending: pendingDec,
        }).available.toNumber()

    return {
      id: lt.id,
      name: lt.name,
      isUnpaid: lt.isUnpaid,
      available,
      credited,
      used,
      pending: pendingDec.toNumber(),
    }
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">My Leaves</h1>
        <div className="flex gap-2">
          {isAdmin && <Button asChild variant="outline"><Link href="/leaves/approvals">Review Requests</Link></Button>}
          {employeeId && balanceCards.length > 0 && <ApplyLeaveButton leaveTypes={balanceCards} />}
        </div>
      </div>

      {employeeId && balanceCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {balanceCards.map((bc) => (
            <Card key={bc.id} className="p-3 border">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-medium text-muted-foreground truncate" title={bc.name}>
                  {bc.name}
                </span>
                {bc.isUnpaid && <Badge variant="secondary" className="text-[10px]">Unpaid</Badge>}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold">{bc.isUnpaid ? '—' : bc.available}</span>
                {!bc.isUnpaid && <span className="text-xs text-muted-foreground">days left</span>}
              </div>
              {!bc.isUnpaid && (
                <div className="mt-1 text-[11px] text-muted-foreground truncate">
                  Credited: {bc.credited} · Used: {bc.used}{bc.pending > 0 ? ` · Pending: ${bc.pending}` : ''}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-left">
                <tr>
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 font-medium">From</th>
                  <th className="p-3 font-medium">To</th>
                  <th className="p-3 font-medium">Days</th>
                  <th className="p-3 font-medium">Reason</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Reviewer</th>
                </tr>
              </thead>
              <tbody>
                {myLeaves.map((l) => (
                  <tr key={l.id} className="border-t hover:bg-muted/40">
                    <td className="p-3 font-medium">{l.leaveType.name}</td>
                    <td className="p-3 whitespace-nowrap">{fmtDate(l.startDate)}</td>
                    <td className="p-3 whitespace-nowrap">{fmtDate(l.endDate)}</td>
                    <td className="p-3">{l.days}</td>
                    <td className="p-3 max-w-[220px] truncate" title={l.reason}>{l.reason}</td>
                    <td className="p-3">{statusBadge(l.status)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{l.reviewedBy?.name ?? '—'}{l.reviewComment ? ` · ${l.reviewComment}` : ''}</td>
                  </tr>
                ))}
                {!myLeaves.length && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground"><CalendarX className="h-8 w-8 mx-auto mb-2 opacity-40" />No leave applications yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={page}
            pageSize={pageSize}
            total={total}
            baseUrl="/leaves"
          />
        </CardContent>
      </Card>
    </div>
  )
}
