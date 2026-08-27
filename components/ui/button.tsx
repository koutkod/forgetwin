import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'default' | 'sm' | 'icon';
};

const variants = {
  default: 'bg-emerald-400 text-[#05120d] hover:bg-emerald-300 shadow-[0_0_28px_rgba(52,211,153,.12)]',
  secondary: 'bg-white/[.07] text-slate-100 hover:bg-white/[.11]',
  outline: 'border border-white/10 bg-transparent text-slate-300 hover:bg-white/[.05] hover:text-white',
  ghost: 'bg-transparent text-slate-400 hover:bg-white/[.05] hover:text-white',
  danger: 'border border-red-400/25 bg-red-400/10 text-red-200 hover:bg-red-400/15',
};

const sizes = {
  default: 'h-10 px-4 text-sm',
  sm: 'h-8 px-3 text-xs',
  icon: 'size-9 p-0',
};

export function Button({ className, variant = 'default', size = 'default', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn('inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45', variants[variant], sizes[size], className)} {...props} />;
}
