import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
  separator?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  return createPortal(
    <div
      className="menu"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - items.length * 28 - 10),
        zIndex: 1000
      }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="menu-separator" />
        ) : (
          <div
            key={i}
            className={`menu-item${item.disabled ? ' disabled' : ''}`}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onClick()
            }}
          >
            {item.label}
          </div>
        )
      )}
    </div>,
    document.body
  )
}
