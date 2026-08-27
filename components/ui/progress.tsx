import { cn } from '../../lib/utils';

export function Progress({ value, className, label = 'Progress' }: { value: number; className?: string; label?: string }) {
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-white/[.07]', className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
