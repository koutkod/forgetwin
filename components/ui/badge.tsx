import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const styles = {
  neutral: 'border-white/10 bg-white/[.04] text-slate-400',
  verified: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  unresolved: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  contradicted: 'border-red-400/25 bg-red-400/10 text-red-300',
  human: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
};

export function Badge({ className, variant = 'neutral', ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof styles }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none', styles[variant], className)} {...props} />;
}
