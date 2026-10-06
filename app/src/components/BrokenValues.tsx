import type {ReactNode} from 'react'
import type {Invalid, KeyProblem, RichTextProblem} from '../lib/broken'
import {ErrorOutline, WarningOutline} from './icons'

// J39: the cards Sanity draws in place of an input whose stored value it can't edit,
// with its wording. Each offers the fix (convert, reset, add keys, remove); the form's
// disabled fieldset disables the buttons when the doc is read-only.

const json = (v: unknown) => JSON.stringify(v, null, 2)

function Card({tone, title, text, dev, children}: {tone: 'warn' | 'danger'; title: string; text: string; dev: ReactNode; children: ReactNode}) {
  return (
    <div className="broken-card" data-tone={tone} role="alert">
      <div className="broken-head">
        {tone === 'warn' ? <WarningOutline /> : <ErrorOutline />}
        <div>
          <strong>{title}</strong>
          <p>{text}</p>
          <details open>
            <summary>Developer info</summary>
            {dev}
          </details>
        </div>
      </div>
      <div className="broken-actions">{children}</div>
    </div>
  )
}

/** A value of the wrong type: Sanity's "Invalid property value". */
export function InvalidValueCard({invalid, value, onChange}: {invalid: Invalid; value: unknown; onChange: (v: unknown) => void}) {
  return (
    <Card
      tone="danger"
      title="Invalid property value"
      text="The property value is stored as a value type that does not match the expected type."
      dev={
        <>
          <p>
            The value of this property must be of type <code>{invalid.expected}</code> according to the schema.
          </p>
          <p>Mismatching value types typically occur when the schema has recently been changed.</p>
          <p className="broken-label">
            The current value (<code>{invalid.actual}</code>)
          </p>
          <pre className="broken-value">{json(value)}</pre>
        </>
      }
    >
      {'convert' in invalid && (
        <button type="button" className="btn broken-btn" onClick={() => onChange(invalid.convert)}>
          Convert to {invalid.expected}
        </button>
      )}
      <button type="button" className="btn broken-btn danger" onClick={() => onChange(undefined)}>
        Reset value
      </button>
    </Card>
  )
}

/** List items without keys, or sharing one: the list can't be edited until fixed. */
export function KeysAlert({problem, onChange}: {problem: KeyProblem; onChange: (v: unknown) => void}) {
  const missing = problem.kind === 'missing'
  return (
    <Card
      tone="warn"
      title={missing ? 'Missing keys' : 'Non-unique keys'}
      text={
        missing
          ? 'Some items in the list are missing their keys. This must be fixed in order to edit the list.'
          : 'Several items in this list share the same identifier (key). Every item must have an unique identifier.'
      }
      dev={
        <>
          <p>
            {missing ? (
              <>
                This usually happens when items are created using an API client, and the <code>_key</code> property has not been included.
              </>
            ) : (
              <>
                This usually happens when items are copied with an API client and their <code>_key</code> kept.
              </>
            )}
          </p>
          <p>
            The value of the <code>_key</code> property must be a unique string.
          </p>
        </>
      }
    >
      <button type="button" className="btn broken-btn warn" onClick={() => onChange(problem.fixed)}>
        {missing ? 'Add missing keys' : 'Generate unique keys'}
      </button>
    </Card>
  )
}

/** Rich text blocks the canvas can't draw: give ids to blocks without one, drop the rest. */
export function RichTextCard({problem, onChange}: {problem: RichTextProblem; onChange: (v: unknown) => void}) {
  const onlyIds = problem.problems.every((p) => p.reason === 'no block id')
  return (
    <Card
      tone="warn"
      title="Invalid rich text"
      text="Some blocks in this text can't be edited. Fix them to edit the text."
      dev={
        <ul className="broken-list">
          {problem.problems.map((p) => (
            <li key={p.index}>{p.index < 0 ? p.reason : `Block ${p.index + 1}: ${p.reason}`}</li>
          ))}
        </ul>
      }
    >
      <button type="button" className="btn broken-btn warn" onClick={() => onChange(problem.fixed)}>
        {onlyIds ? 'Add missing block ids' : 'Fix blocks (drops the broken ones)'}
      </button>
    </Card>
  )
}

/** Fields in the doc the schema doesn't define: Sanity's card at the end of the form. */
export function UnknownFields({doc, names, onRemove}: {doc: Record<string, unknown>; names: string[]; onRemove: (name: string) => void}) {
  if (!names.length) return null
  const one = names.length === 1
  return (
    <div className="broken-unknown">
    <Card
      tone="warn"
      title={one ? 'Unknown field found' : 'Unknown fields found'}
      text={one ? 'Encountered a field that is not defined in the schema.' : `Encountered ${names.length} fields that are not defined in the schema.`}
      dev={
        <p>
          {one ? 'This field is' : 'These fields are'} not defined in the schema, which could mean that the field definition has been removed or that someone else has added it to their own local
          project and have not deployed their changes yet.
        </p>
      }
    >
      {names.map((n) => (
        <div key={n} className="broken-field">
          <code className="broken-name">{n}</code>
          <pre className="broken-value">{json(doc[n])}</pre>
          <button type="button" className="btn broken-btn danger-text" aria-label={`Remove field ${n}`} onClick={() => onRemove(n)}>
            Remove field
          </button>
        </div>
      ))}
    </Card>
    </div>
  )
}
