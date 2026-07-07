import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: React.ReactNode
  width?: number | string
  onClose: () => void
  children: React.ReactNode
  /** rendered inside .modal-footer when provided */
  footer?: React.ReactNode
  /** block overlay-click/Escape close (e.g. during a busy operation) */
  locked?: boolean
}

/** Shared modal: overlay, Escape/overlay-click close, header with ✕, optional footer. */
export default function Modal({ title, width = 480, onClose, children, footer, locked }: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !locked) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, locked])

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose()
      }}
    >
      <div className="modal" style={{ width }}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="icon" onClick={onClose} disabled={locked} title="Close (Esc)">
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
