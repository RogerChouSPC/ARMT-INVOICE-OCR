import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Small themed confirmation dialog built on the native <dialog> element so it is
 * focus-trapped, Esc-dismissable, and accessible by default. Used to guard
 * destructive actions (row delete, clear history) without a heavy modal library.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onCancel() }}
      onClose={onCancel}
      className="m-auto rounded-2xl border border-border bg-background text-foreground shadow-card p-0 backdrop:bg-black/40 w-[min(92vw,22rem)]"
    >
      <div className="p-5 flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {message && <p className="text-xs text-muted-foreground mt-1.5">{message}</p>}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button className="btn-secondary text-xs" onClick={onCancel} autoFocus>
            {cancelLabel}
          </button>
          <button
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-destructive text-destructive-foreground rounded-xl text-sm font-medium transition-all duration-150 hover:opacity-90 active:scale-95"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
