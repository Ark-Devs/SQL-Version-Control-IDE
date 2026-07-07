import { useState } from 'react'
import Modal from '../common/Modal'
import { useSettings } from '../../state/settingsStore'
import { useTabs } from '../../state/tabsStore'
import { procTemplate, scalarFunctionTemplate, tvfTemplate, viewTemplate } from '../../utils/changelog'

export type NewObjectKind = 'proc' | 'scalar' | 'tvf' | 'view'

export interface NewObjectTarget {
  connId: string
  database: string
  kind: NewObjectKind
}

const kindLabel: Record<NewObjectKind, string> = {
  proc: 'Stored Procedure',
  scalar: 'Scalar Function',
  tvf: 'Table-valued Function',
  view: 'View'
}

const kindPrefix: Record<NewObjectKind, string> = {
  proc: 'usp_',
  scalar: 'fn_',
  tvf: 'tvf_',
  view: 'vw_'
}

/** SSMS-style "new object" dialog: asks name + description, fills the header template. */
export default function NewObjectDialog({ target, onClose }: { target: NewObjectTarget; onClose: () => void }): React.JSX.Element {
  const author = useSettings((s) => s.settings.authorName)
  const [name, setName] = useState(kindPrefix[target.kind])
  const [desc, setDesc] = useState('')

  const create = (): void => {
    const fullName = name.includes('.') ? name : `dbo.${name}`
    const a = author || 'unknown'
    const content =
      target.kind === 'proc'
        ? procTemplate(a, fullName, desc)
        : target.kind === 'scalar'
          ? scalarFunctionTemplate(a, fullName, desc)
          : target.kind === 'tvf'
            ? tvfTemplate(a, fullName, desc)
            : viewTemplate(a, fullName, desc)
    useTabs.getState().openTab({
      title: fullName,
      connId: target.connId,
      database: target.database,
      content,
      origin: 'template'
    })
    onClose()
  }

  return (
    <Modal
      title={`New ${kindLabel[target.kind]} — ${target.database}`}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!name.trim() || name.trim() === kindPrefix[target.kind]} onClick={create}>
            Create
          </button>
        </>
      }
    >
      <label style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--text-dim)' }}>Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${kindPrefix[target.kind]}MyObject or schema.name`}
        />
      </label>
      <label style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'start', gap: 8 }}>
        <span style={{ color: 'var(--text-dim)', paddingTop: 4 }}>Description</span>
        <textarea
          rows={2}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="What is this object for? (goes into the header)"
          style={{ resize: 'vertical', fontFamily: 'var(--font-ui)' }}
        />
      </label>
      <div className="hint">Author: {author || '(set in Settings)'} — header is filled automatically.</div>
    </Modal>
  )
}
