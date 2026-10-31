import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationControlsProps {
  page: number
  pageSize: number
  total: number
  baseUrl: string
  searchParams?: Record<string, string | number | undefined | null>
}

export function PaginationControls({
  page,
  pageSize,
  total,
  baseUrl,
  searchParams = {},
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null

  const createPageUrl = (targetPage: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== null && v !== '' && k !== 'page') {
        params.set(k, String(v))
      }
    }
    params.set('page', String(targetPage))
    return `${baseUrl}?${params.toString()}`
  }

  return (
    <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
      <span>
        Showing {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          asChild={page > 1}
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={page <= 1}
        >
          {page > 1 ? (
            <Link href={createPageUrl(page - 1)}>
              <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Prev
            </Link>
          ) : (
            <span className="opacity-50 flex items-center">
              <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Prev
            </span>
          )}
        </Button>
        <span className="px-2 font-medium text-foreground">
          {page} / {totalPages}
        </span>
        <Button
          asChild={page < totalPages}
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={page >= totalPages}
        >
          {page < totalPages ? (
            <Link href={createPageUrl(page + 1)}>
              Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          ) : (
            <span className="opacity-50 flex items-center">
              Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </span>
          )}
        </Button>
      </div>
    </div>
  )
}

