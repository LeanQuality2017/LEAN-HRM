import { redirect } from 'next/navigation'

// Shared page access check returning redirect target or null if permitted
export function checkPageAccess(role: string, pathname: string): string | null {
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/'

  // Public/shared routes for all authenticated users
  if (path === '/dashboard' || path === '/profile' || path === '/announcements' || path === '/' || path === '/offline') {
    return null
  }

  // Students are restricted to dashboard, profile, announcements
  if (role === 'STUDENT') {
    return '/dashboard'
  }

  // /companies -> SUPER_ADMIN + COMPANY_ADMIN
  if (path === '/companies' || path.startsWith('/companies/')) {
    if (!['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(role)) {
      return '/dashboard'
    }
    return null
  }

  // /audit -> SUPER_ADMIN + COMPANY_ADMIN + HR
  if (path === '/audit' || path.startsWith('/audit/')) {
    if (!['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR'].includes(role)) {
      return '/dashboard'
    }
    return null
  }

  // /leaves/approvals -> MANAGEMENT_ROLES (SUPER_ADMIN, COMPANY_ADMIN, HR, MANAGER)
  if (path === '/leaves/approvals' || path.startsWith('/leaves/approvals/')) {
    if (!['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER'].includes(role)) {
      return '/dashboard'
    }
    return null
  }

  // /employees, /recruitment -> HR_ROLES + MANAGER
  if (
    path === '/employees' || path.startsWith('/employees/') ||
    path === '/recruitment' || path.startsWith('/recruitment/')
  ) {
    if (!['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER'].includes(role)) {
      return '/dashboard'
    }
    return null
  }

  // /payroll -> staff roles (employees can view their own payslips, HR can manage)
  if (path === '/payroll' || path.startsWith('/payroll/')) {
    if (!['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'].includes(role)) {
      return '/dashboard'
    }
    return null
  }

  // /institute/* -> SUPER_ADMIN + COMPANY_ADMIN
  if (path === '/institute' || path.startsWith('/institute/')) {
    if (!['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(role)) {
      return '/dashboard'
    }
    return null
  }

  // General staff modules (/attendance, /work-reports, /performance, /leaves) -> staff roles
  if (!['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'].includes(role)) {
    return '/dashboard'
  }

  return null
}

// Assert server-side page access; redirect if unauthorized
export function assertPageAccess(role: string, pathname: string): void {
  const redirectTarget = checkPageAccess(role, pathname)
  if (redirectTarget && redirectTarget !== pathname) {
    redirect(redirectTarget)
  }
}
