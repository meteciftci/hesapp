import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Button } from './ui'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Geri alınamayan işlem: onay düğmesi kırmızı olur. */
  destructive?: boolean
  /** Verilirse onay düğmesi, bu metin yazılana kadar kapalı kalır (geri alınamaz işlemler için). */
  requireText?: string
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/** Tarayıcının yerleşik `confirm` penceresi yerine uygulama içi onay penceresi. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('ConfirmProvider eksik')
  return confirm
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [typed, setTyped] = useState('')

  const confirm = useCallback<Confirm>((options) => new Promise<boolean>((resolve) => {
    setTyped('')
    setPending({ options, resolve })
  }), [])

  function answer(ok: boolean) {
    pending?.resolve(ok)
    setPending(null)
  }

  useEffect(() => {
    if (!pending) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pending.resolve(false)
        setPending(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending])

  const options = pending?.options
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => answer(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={options.message ? 'confirm-message' : undefined} className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-1.5">
              <h2 id="confirm-title" className="text-lg font-semibold">{options.title}</h2>
              {options.message && <p id="confirm-message" className="text-sm text-muted">{options.message}</p>}
            </div>
            {options.requireText && (
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Onaylamak için “{options.requireText}” yazın
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" className="min-h-12 rounded-xl border border-edge bg-transparent px-3 text-base font-normal text-ink" />
              </label>
            )}
            <div className="flex gap-2.5">
              <button ref={cancelRef} type="button" onClick={() => answer(false)} className="min-h-12 grow rounded-2xl border border-edge bg-surface px-4 font-medium">{options.cancelLabel ?? 'Vazgeç'}</button>
              <Button type="button" variant={options.destructive ? 'danger' : 'primary'} className="grow" disabled={!!options.requireText && typed.trim().toLocaleUpperCase('tr') !== options.requireText.toLocaleUpperCase('tr')} onClick={() => answer(true)}>{options.confirmLabel ?? 'Evet'}</Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
