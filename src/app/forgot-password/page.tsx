'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, ArrowLeft, Mail, CheckCircle2, AlertCircle } from 'lucide-react'

function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMessage(null)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMessage(data?.error || 'Unable to process your request. Please try again.')
      } else {
        setSubmitted(true)
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
          <CardTitle className="text-xl">Forgot Password</CardTitle>
          <CardDescription>
            Enter your email address and we will send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 p-3 rounded bg-teal-50 border border-teal-200 text-teal-800 text-sm">
                <CheckCircle2 className="h-5 w-5 text-teal-600 shrink-0 mt-0.5" />
                <span>
                  If an account exists for <strong>{email}</strong>, instructions to reset your password have been sent.
                </span>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Check your inbox (and spam folder). The link will expire in 30 minutes.
              </p>
              <div className="pt-2 text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center text-sm font-medium text-teal-700 hover:text-teal-800"
                >
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Return to sign in
                </Link>
              </div>
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
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@unihr.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Mail className="h-4 w-4 mr-2" />
                )}
                Send reset link
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

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-teal-50/60" />}>
      <ForgotPasswordForm />
    </Suspense>
  )
}

