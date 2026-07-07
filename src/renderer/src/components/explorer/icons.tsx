const style = { marginRight: 5, fontSize: 12, width: 16, display: 'inline-block', textAlign: 'center' as const }

export const Icons = {
  server: <span style={{ ...style, color: '#c8a83a' }}>🖥</span>,
  database: <span style={{ ...style, color: '#e8c15c' }}>🗄</span>,
  folder: <span style={{ ...style, color: '#dcb67a' }}>📁</span>,
  table: <span style={{ ...style, color: '#6ea1d8' }}>▦</span>,
  view: <span style={{ ...style, color: '#8ec7eb' }}>◫</span>,
  proc: <span style={{ ...style, color: '#d8a45c' }}>⚙</span>,
  tvf: <span style={{ ...style, color: '#b18ce0' }}>ƒ⊞</span>,
  scalar: <span style={{ ...style, color: '#b18ce0' }}>ƒ</span>,
  column: <span style={{ ...style, color: '#9db4c8' }}>▪</span>,
  key: <span style={{ ...style, color: '#e8c15c' }}>🔑</span>,
  fk: <span style={{ ...style, color: '#9db4c8' }}>🔗</span>,
  index: <span style={{ ...style, color: '#9db4c8' }}>≡</span>,
  constraint: <span style={{ ...style, color: '#c8a83a' }}>☑</span>,
  trigger: <span style={{ ...style, color: '#e07f7f' }}>⚡</span>,
  synonym: <span style={{ ...style, color: '#8ec7eb' }}>↪</span>,
  param: <span style={{ ...style, color: '#7fb8e0' }}>@</span>,
  type: <span style={{ ...style, color: '#b18ce0' }}>𝕋</span>,
  sequence: <span style={{ ...style, color: '#89d185' }}>#</span>,
  user: <span style={{ ...style, color: '#c8c8c8' }}>👤</span>,
  role: <span style={{ ...style, color: '#c8c8c8' }}>👥</span>,
  schema: <span style={{ ...style, color: '#dcb67a' }}>⬚</span>
}
