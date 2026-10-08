import { useEffect, useRef, type ReactNode } from 'react'

export default function Modal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const modalRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const modal = modalRef.current
    const first =
      modal?.querySelector<HTMLElement>('input, select') ??
      modal?.querySelector<HTMLElement>('button')
    first?.focus()
    return () => previous?.focus()
  }, [])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Tab') {
            const elements = Array.from(
              modalRef.current?.querySelectorAll<HTMLElement>(
                ':is(button, input, select, summary):not(:disabled):not([tabindex="-1"])'
              ) ?? []
            )
            const first = elements[0],
              last = elements.at(-1)
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last?.focus()
            }
            if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
