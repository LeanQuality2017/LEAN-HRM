'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/constants'
import {
  LayoutDashboard, Building2, Users, CalendarCheck, CalendarX, FileText, Wallet,
  Briefcase, Target, GraduationCap, BookOpen, ReceiptIndianRupee, ClipboardCheck,
  Handshake, Megaphone, UserCircle, LogOut, Menu, Bell, X, ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PwaRegister } from '@/components/pwa-register'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface ShellUser {
  id: string; name: string; email: string; role: string; employeeCode: string | null
}
export interface ShellCompany { id: string; name: string; code: string; type: string }

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'STUDENT'] },
  { href: '/companies', label: 'Companies', icon: Building2, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'] },
  { href: '/employees', label: 'Employees', icon: Users, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'] },
  { href: '/attendance', label: 'Attendance', icon: CalendarCheck, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
  { href: '/leaves', label: 'Leaves', icon: CalendarX, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
  { href: '/work-reports', label: 'Work Reports', icon: FileText, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
  { href: '/payroll', label: 'Payroll', icon: Wallet, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'EMPLOYEE'] },
  { href: '/recruitment', label: 'Recruitment', icon: Briefcase, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'] },
  { href: '/performance', label: 'Performance', icon: Target, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] },
  { label: 'Institute', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'] },
  { href: '/institute/students', label: 'Students', icon: GraduationCap, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'] },
  { href: '/institute/courses', label: 'Courses & Batches', icon: BookOpen, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { href: '/institute/fees', label: 'Fees', icon: ReceiptIndianRupee, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'] },
  { href: '/institute/assessments', label: 'Assessments', icon: ClipboardCheck, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'] },
  { href: '/institute/placements', label: 'Placements', icon: Handshake, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'] },
  { label: 'General', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'STUDENT'] },
  { href: '/announcements', label: 'Announcements', icon: Megaphone, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'STUDENT'] },
  { href: '/audit', label: 'Audit Log', icon: ShieldCheck, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'] },
  { href: '/profile', label: 'My Profile', icon: UserCircle, roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'STUDENT'] },
]

export function AppShell({
  user, companies, unreadCount, enabledModules, children,
}: {
  user: ShellUser
  companies: ShellCompany[]
  unreadCount: number
  enabledModules?: { payroll?: boolean; institute?: boolean }
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const isPayrollActive = enabledModules?.payroll ?? false
  const isInstituteActive = enabledModules?.institute ?? false

  const items = NAV.filter((n) => {
    if (!n.roles.includes(user.role)) return false
    if (n.href === '/payroll' && !isPayrollActive) return false
    if (n.href?.startsWith('/institute') && !isInstituteActive) return false
    if (!n.href && n.label === 'Institute' && !isInstituteActive) return false
    return true
  })

  const nav = (
    <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
      {items.map((item, i) =>
        !item.href ? (
          <div key={`sep-${i}-${item.label}`} className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {item.label}
          </div>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname === item.href || pathname?.startsWith(item.href + '/')
                ? 'bg-teal-700 text-white'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
            {item.label}
          </Link>
        )
      )}
    </nav>
  )

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <Link href={user.role === 'SUPER_ADMIN' ? '/companies' : '/dashboard'} className="flex items-center gap-2 font-bold text-teal-800">
            <span className="w-7 h-7 rounded-lg bg-teal-700 text-white flex items-center justify-center text-sm">U</span>
            UniHR
          </Link>
          <div className="hidden md:flex items-center gap-1.5 ml-2 flex-wrap">
            {companies.map((c) => (
              <Badge key={c.id} variant="outline" className="text-[11px] font-medium">
                {c.code}{c.type === 'INSTITUTE' ? ' · T&P' : ''}
              </Badge>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="relative" onClick={() => router.push('/dashboard#notifications')} aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-4 min-w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center px-1">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2">
                  <span className="w-7 h-7 rounded-full bg-teal-100 text-teal-800 text-xs font-bold flex items-center justify-center">
                    {user.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                  </span>
                  <span className="hidden sm:block text-sm max-w-[140px] truncate">{user.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm font-semibold">{user.name}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                  <div className="mt-1 flex gap-1.5">
                    <Badge className="bg-teal-700 text-[10px]">{ROLE_LABELS[user.role]}</Badge>
                    {user.employeeCode && <Badge variant="outline" className="text-[10px]">{user.employeeCode}</Badge>}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/profile')}>My Profile</DropdownMenuItem>
                <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })} className="text-red-600">
                  <LogOut className="h-4 w-4 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:flex-col w-56 shrink-0 border-r bg-white sticky top-14 h-[calc(100vh-3.5rem)]">
          {nav}
          <div className="px-2 pb-2 mt-auto">
            <PwaRegister />
          </div>
        </aside>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white flex flex-col shadow-xl">
              <div className="flex h-14 items-center justify-between px-4 border-b">
                <span className="font-bold text-teal-800">UniHR</span>
                <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></Button>
              </div>
              {nav}
              <div className="px-2 pb-2 mt-auto">
                <PwaRegister />
              </div>
            </aside>
          </div>
        )}

        {/* Main */}
        <main className="flex-1 min-w-0 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
