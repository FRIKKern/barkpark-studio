import type {ReactNode} from 'react'
import type {Invalid, KeyProblem, RichTextProblem} from '../lib/broken'
import {ErrorOutline, WarningOutline} from './icons'
import {useT} from '../lib/i18n'

// J39: the cards Sanity draws in place of an input whose stored value it can't edit,
// with its wording. Each offers the fix (convert, reset, add keys, remove); the form's
// disabled fieldset disables the buttons when the doc is read-only.

const json = (v: unknown) => JSON.stringify(v, null, 2)

function Card({tone, title, text, dev, children}: {tone: 'warn' | 'danger'; title: string; text: string; dev: ReactNode; children: ReactNode}) {
  const t = useT()
  return (
    <div className="broken-card" data-tone={tone} role="alert">
      <div className="broken-head">
        {tone === 'warn' ? <WarningOutline /> : <ErrorOutline />}
        <div>
          <strong>{title}</strong>
          <p>{text}</p>
          <details open>
            <summary>{t('Developer info')}</summary>
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
  const t = useT()
  const [typeBefore, typeAfter] = t('The value of this property must be of type {type} according to the schema.').split('{type}')
  const [currentBefore, currentAfter] = t('The current value ({type})').split('{type}')
  return (
    <Card
      tone="danger"
      title={t('Invalid property value')}
      text={t('The property value is stored as a value type that does not match the expected type.')}
      dev={
        <>
          <p>
            {typeBefore}
            <code>{invalid.expected}</code>
            {typeAfter}
          </p>
          <p>{t('Mismatching value types typically occur when the schema has recently been changed.')}</p>
          <p className="broken-label">
            {currentBefore}
            <code>{invalid.actual}</code>
            {currentAfter}
          </p>
          <pre className="broken-value">{json(value)}</pre>
        </>
      }
    >
      {'convert' in invalid && (
        <button type="button" className="btn broken-btn" onClick={() => onChange(invalid.convert)}>
          {t('Convert to {type}', {type: invalid.expected})}
        </button>
      )}
      <button type="button" className="btn broken-btn danger" onClick={() => onChange(undefined)}>
        {t('Reset value')}
      </button>
    </Card>
  )
}

/** List items without keys, or sharing one: the list can't be edited until fixed. */
export function KeysAlert({problem, onChange}: {problem: KeyProblem; onChange: (v: unknown) => void}) {
  const t = useT()
  const missing = problem.kind === 'missing'
  const [keyBefore, keyAfter] = (
    missing
      ? t('This usually happens when items are created using an API client, and the {key} property has not been included.')
      : t('This usually happens when items are copied with an API client and their {key} kept.')
  ).split('{key}')
  const [uniqueBefore, uniqueAfter] = t('The value of the {key} property must be a unique string.').split('{key}')
  return (
    <Card
      tone="warn"
      title={missing ? t('Missing keys') : t('Non-unique keys')}
      text={
        missing
          ? t('Some items in the list are missing their keys. This must be fixed in order to edit the list.')
          : t('Several items in this list share the same identifier (key). Every item must have an unique identifier.')
      }
      dev={
        <>
          <p>
            {keyBefore}
            <code>_key</code>
            {keyAfter}
          </p>
          <p>
            {uniqueBefore}
            <code>_key</code>
            {uniqueAfter}
          </p>
        </>
      }
    >
      <button type="button" className="btn broken-btn warn" onClick={() => onChange(problem.fixed)}>
        {missing ? t('Add missing keys') : t('Generate unique keys')}
      </button>
    </Card>
  )
}

/** Rich text blocks the canvas can't draw: give ids to blocks without one, drop the rest. */
export function RichTextCard({problem, onChange}: {problem: RichTextProblem; onChange: (v: unknown) => void}) {
  const t = useT()
  const onlyIds = problem.problems.every((p) => p.reason === 'no block id')
  return (
    <Card
      tone="warn"
      title={t('Invalid rich text')}
      text={t("Some blocks in this text can't be edited. Fix them to edit the text.")}
      dev={
        <ul className="broken-list">
          {problem.problems.map((p) => (
            <li key={p.index}>{p.index < 0 ? p.reason : t('Block {n}: {reason}', {n: p.index + 1, reason: p.reason})}</li>
          ))}
        </ul>
      }
    >
      <button type="button" className="btn broken-btn warn" onClick={() => onChange(problem.fixed)}>
        {onlyIds ? t('Add missing block ids') : t('Fix blocks (drops the broken ones)')}
      </button>
    </Card>
  )
}

/** Fields in the doc the schema doesn't define: Sanity's card at the end of the form. */
export function UnknownFields({doc, names, onRemove}: {doc: Record<string, unknown>; names: string[]; onRemove: (name: string) => void}) {
  const t = useT()
  if (!names.length) return null
  const one = names.length === 1
  return (
    <div className="broken-unknown">
    <Card
      tone="warn"
      title={one ? t('Unknown field found') : t('Unknown fields found')}
      text={one ? t('Encountered a field that is not defined in the schema.') : t('Encountered {n} fields that are not defined in the schema.', {n: names.length})}
      dev={
        <p>
          {one
            ? t('This field is not defined in the schema, which could mean that the field definition has been removed or that someone else has added it to their own local project and have not deployed their changes yet.')
            : t('These fields are not defined in the schema, which could mean that the field definition has been removed or that someone else has added it to their own local project and have not deployed their changes yet.')}
        </p>
      }
    >
      {names.map((n) => (
        <div key={n} className="broken-field">
          <code className="broken-name">{n}</code>
          <pre className="broken-value">{json(doc[n])}</pre>
          <button type="button" className="btn broken-btn danger-text" aria-label={t('Remove field {name}', {name: n})} onClick={() => onRemove(n)}>
            {t('Remove field')}
          </button>
        </div>
      ))}
    </Card>
    </div>
  )
}
