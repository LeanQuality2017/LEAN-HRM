import { cn } from '@/lib/utils'
import { type LucideIcon } from 'lucide-react'

export function StatCard({ title, value, sub, icon: Icon, tone = 'default' }: {
  title: string; value: string | number; sub?: string; icon: LucideIcon; tone?: 'default' | 'warn' | 'good' | 'bad'
}) {
  const tones = {
    default: 'bg-teal-50 text-teal-700',
    warn: 'bg-amber-50 text-amber-700',
    good: 'bg-emerald-50 text-emerald-700',
    bad: 'bg-red-50 text-red-700',
  }
  return (
    <div className="rounded-lg border bg-white p-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div className="text-2xl font-bold mt-1 truncate">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </div>
      <div className={cn('rounded-lg p-2 shrink-0', tones[tone])}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  )
}
