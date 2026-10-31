'use client'

import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let swRegistered = false

export function PwaRegister() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Register Service Worker ONLY in production mode
    if (!swRegistered && process.env.NODE_ENV === 'production' && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      swRegistered = true
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => {
          console.error('[PWA] SW registration failed:', err)
        })
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    const handleAppInstalled = () => {
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'accepted') {
      setDeferredPrompt(null)
    }
  }

  // If beforeinstallprompt is not available (e.g. iOS or already installed) or dismissed: hide button
  if (!deferredPrompt || dismissed) {
    return null
  }

  return (
    <div className="p-2 border border-teal-200/60 bg-teal-50/70 rounded-md flex items-center justify-between gap-1 text-xs">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleInstall}
        className="h-7 px-1.5 text-xs font-medium text-teal-800 hover:text-teal-900 hover:bg-teal-100/70 flex items-center gap-1.5 flex-1 justify-start"
      >
        <Download className="h-3.5 w-3.5 text-teal-700 shrink-0" />
        <span className="truncate">Install UniHR</span>
      </Button>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 text-muted-foreground hover:text-foreground rounded-sm transition-colors"
        aria-label="Dismiss install prompt"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

