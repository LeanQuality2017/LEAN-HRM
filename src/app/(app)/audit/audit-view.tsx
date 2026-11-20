'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

interface AuditItem {
  id: string
  userId: string | null
  action: string
  entity: string
  entityId: string | null
  meta: string | null
  createdAt: string
  user: {
    id: string
    name: string
    email: string
    role: string
  } | null
}

export function AuditView({
  initialLogs,
  initialTotal = 0,
  users,
  actions,
}: {
  initialLogs: AuditItem[]
  initialTotal?: number
  users: { id: string; name: string; email: string }[]
  actions: string[]
}) {
  const [logs, setLogs] = useState<AuditItem[]>(initialLogs)
  const [total, setTotal] = useState<number>(initialTotal)
  const [page, setPage] = useState<number>(1)
  const pageSize = 25
  const [selectedUser, setSelectedUser] = useState<string>('all')
  const [selectedAction, setSelectedAction] = useState<string>('all')
  const [loading, setLoading] = useState<boolean>(false)

  // When filters change, reset to page 1
  const handleUserChange = (val: string) => {
    setSelectedUser(val)
    setPage(1)
  }

  const handleActionChange = (val: string) => {
    setSelectedAction(val)
    setPage(1)
  }

  useEffect(() => {
    async function fetchFiltered() {
      setLoading(true)
      const params = new URLSearchParams()
      if (selectedUser !== 'all') params.set('userId', selectedUser)
      if (selectedAction !== 'all') params.set('action', selectedAction)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))

      try {
        const res = await fetch(`/api/audit?${params.toString()}`)
        const json = await res.json()
        if (json.ok && Array.isArray(json.data)) {
          setLogs(json.data)
          if (typeof json.total === 'number') {
            setTotal(json.total)
          }
        }
      } catch (err) {
        console.error('Failed to fetch audit logs:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchFiltered()
  }, [selectedUser, selectedAction, page])

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Filter Logs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">User</label>
            <Select value={selectedUser} onValueChange={handleUserChange}>
              <SelectTrigger>
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Action</label>
            <Select value={selectedAction} onValueChange={handleActionChange}>
              <SelectTrigger>
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actions.map((act) => (
                  <SelectItem key={act} value={act}>
                    {act}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Events ({total})
            </CardTitle>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="p-2 font-medium">Time</th>
                  <th className="p-2 font-medium">User</th>
                  <th className="p-2 font-medium">Action</th>
                  <th className="p-2 font-medium">Entity</th>
                  <th className="p-2 font-medium">Entity ID</th>
                  <th className="p-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-muted-foreground">
                      No audit events found.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/20">
                      <td className="p-2 whitespace-nowrap text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        <div className="font-medium text-foreground">{log.user?.name ?? 'Unknown'}</div>
                        <div className="text-[10px] text-muted-foreground">{log.user?.email ?? log.userId}</div>
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {log.action}
                        </Badge>
                      </td>
                      <td className="p-2 whitespace-nowrap font-medium text-foreground">
                        {log.entity}
                      </td>
                      <td className="p-2 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                        {log.entityId || '-'}
                      </td>
                      <td className="p-2 text-[11px] text-muted-foreground max-w-xs truncate" title={log.meta || ''}>
                        {log.meta || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 py-4 px-2 text-xs text-muted-foreground">
              <div>
                Showing page <span className="font-medium text-foreground">{page}</span> of{' '}
                <span className="font-medium text-foreground">{totalPages}</span> ({total} items)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

