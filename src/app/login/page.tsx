'use client'

import { Suspense, useState } from 'react'
import { signIn, getSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { LogIn, Loader2, AlertCircle } from 'lucide-react'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialError = searchParams?.get('error')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialError?.includes('Too many attempts') ? 'Too many attempts, try again later' : null
  )

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMessage(null)
    const res = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (res?.error) {
      if (res.error === 'Too many attempts, try again later' || res.error.includes('Too many attempts')) {
        setErrorMessage('Too many attempts, try again later')
        toast({ title: 'Too many attempts, try again later', description: 'Account locked due to multiple failed attempts.', variant: 'destructive' })
      } else {
        setErrorMessage('Invalid email or password.')
        toast({ title: 'Login failed', description: 'Invalid email or password.', variant: 'destructive' })
      }
    } else {
      const session = await getSession()
      const destination = session?.user?.role === 'SUPER_ADMIN' ? '/companies' : '/dashboard'
      router.push(destination)
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-teal-50/60 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-teal-700 text-white flex items-center justify-center text-lg font-bold mb-2">U</div>
          <CardTitle className="text-xl">UniHR</CardTitle>
          <CardDescription>Unified HRMS for the group companies</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {errorMessage && (
              <div className="flex items-center gap-2 p-2.5 rounded bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@unihr.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogIn className="h-4 w-4 mr-2" />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-teal-50/60" />}>
      <LoginForm />
    </Suspense>
  )
}

