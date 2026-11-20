'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, KeyRound, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams?.get('token') || ''

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(
    !token ? 'Missing reset token. Please request a new password reset link.' : null
  )

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) {
      setErrorMessage('Missing password reset token.')
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.')
      return
    }

    setLoading(true)
    setErrorMessage(null)

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMessage(data?.error || 'Failed to reset password. The link may have expired.')
      } else {
        setSuccess(true)
      }
    } catch {
      setErrorMessage('A network error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-teal-50/60 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-teal-700 text-white flex items-center justify-center text-lg font-bold mb-2">
            U
          </div>
          <CardTitle className="text-xl">Set New Password</CardTitle>
          <CardDescription>
            Choose a strong password with at least 8 characters, including letters and numbers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 p-3 rounded bg-teal-50 border border-teal-200 text-teal-800 text-sm">
                <CheckCircle2 className="h-5 w-5 text-teal-600 shrink-0 mt-0.5" />
                <span>Your password has been successfully reset. You can now log in with your new password.</span>
              </div>
              <div className="pt-2">
                <Button asChild className="w-full bg-teal-700 hover:bg-teal-800">
                  <Link href="/login">Sign in now</Link>
                </Button>
              </div>
            </div>
          ) : !token ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 p-3 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <span>This password reset link is invalid or incomplete. Please request a new link.</span>
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link href="/forgot-password">Request new link</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {errorMessage && (
                <div
                  className="flex items-center gap-2 p-2.5 rounded bg-red-50 border border-red-200 text-red-700 text-sm"
                  role="alert"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <KeyRound className="h-4 w-4 mr-2" />
                )}
                Reset Password
              </Button>
              <div className="text-center pt-1">
                <Link
                  href="/login"
                  className="inline-flex items-center text-xs text-muted-foreground hover:text-teal-700"
                >
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-teal-50/60" />}>
      <ResetPasswordForm />
    </Suspense>
  )
}

