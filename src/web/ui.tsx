import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function Page({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-8">
      {title && <h1 className="text-2xl font-semibold">{title}</h1>}
      {children}
    </main>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900 ${className}`}>{children}</section>
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/50',
    secondary: 'border border-black/15 bg-transparent hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10',
    danger: 'border border-red-600/40 text-red-700 hover:bg-red-600/10 dark:text-red-400',
  }[variant]
  return <button className={`min-h-12 rounded-xl px-4 text-base font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`} {...props} />
}

export function Field({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input className="min-h-12 rounded-xl border border-black/15 bg-transparent px-3 text-base font-normal dark:border-white/20" {...props} />
      {hint && <span className="text-xs font-normal opacity-60">{hint}</span>}
    </label>
  )
}

export function Notice({ kind = 'error', children }: { kind?: 'error' | 'info'; children: ReactNode }) {
  const tone = kind === 'error' ? 'bg-red-600/10 text-red-800 dark:text-red-300' : 'bg-indigo-600/10 text-indigo-900 dark:text-indigo-200'
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl px-3 py-2 text-sm ${tone}`}>
      {children}
    </p>
  )
}
