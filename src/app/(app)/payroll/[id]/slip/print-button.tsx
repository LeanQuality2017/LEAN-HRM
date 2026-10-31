'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PrintButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.print()}
      className="no-print gap-1.5"
    >
      <Printer className="h-4 w-4" />
      Print
    </Button>
  )
}

