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
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - items.length * 28 - 10),
        background: 'var(--bg-panel-alt)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        zIndex: 1000,
        minWidth: 200,
        padding: '4px 0'
      }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
        ) : (
          <div
            key={i}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onClick()
            }}
            style={{
              padding: '5px 14px',
              cursor: item.disabled ? 'default' : 'pointer',
              opacity: item.disabled ? 0.5 : 1
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) (e.target as HTMLElement).style.background = 'var(--bg-selected)'
            }}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.background = 'transparent')}
          >
            {item.label}
          </div>
        )
      )}
    </div>,
    document.body
  )
}
