'use client'

import { WifiOff, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-teal-50/60 px-4">
      <Card className="w-full max-w-md text-center shadow-lg border-teal-100">
        <CardHeader className="space-y-3 pb-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-teal-700 text-white flex items-center justify-center shadow-md">
            <WifiOff className="h-7 w-7 text-teal-100" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
            You're offline
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Reconnect to use UniHR
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            UniHR requires an active internet connection to submit reports, verify attendance, and synchronize records. Please check your network and try again.
          </p>
          <div className="pt-2 flex justify-center">
            <Button
              onClick={() => window.location.reload()}
              className="gap-2 bg-teal-700 hover:bg-teal-800 text-white shadow-sm"
              size="sm"
            >
              <RotateCw className="h-4 w-4" />
              Retry connection
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

