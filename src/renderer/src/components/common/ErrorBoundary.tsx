import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * Last-resort guard: a render error anywhere below unmounts to this panel
 * instead of a dead black window.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
        <div style={{ maxWidth: 560, textAlign: 'center' }}>
          <h2 style={{ color: 'var(--text-bright)' }}>Something went wrong</h2>
          <p
            style={{
              color: 'var(--error)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              userSelect: 'text',
              whiteSpace: 'pre-wrap',
              textAlign: 'left',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 12,
              maxHeight: 200,
              overflow: 'auto'
            }}
          >
            {String(this.state.error?.stack ?? this.state.error)}
          </p>
          <button className="primary" onClick={() => window.location.reload()}>
            Reload ArkSQL
          </button>
        </div>
      </div>
    )
  }
}
