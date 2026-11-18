import { redirect } from 'next/navigation'
import { isPayrollEnabled } from '@/lib/feature-gates'

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  if (!isPayrollEnabled()) {
    redirect('/dashboard')
  }

  return <>{children}</>
}

