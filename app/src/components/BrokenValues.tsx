import type {ReactNode} from 'react'
import type {Invalid, KeyProblem, RichTextProblem, SanityPortableText, UnsupportedAsset} from '../lib/broken'
import {ErrorOutline, WarningOutline} from './icons'
import {useT} from '../lib/i18n'

// J39: the cards Sanity draws in place of an input whose stored value it can't edit,
// with its wording. Each offers the fix (convert, reset, add keys, remove); the form's
// disabled fieldset disables the buttons when the doc is read-only.

const json = (v: unknown) => JSON.stringify(v, null, 2)

function Card({tone, title, text, body, dev, devOpen = true, children}: {tone: 'warn' | 'danger'; title: string; text: string; body?: ReactNode; dev: ReactNode; devOpen?: boolean; children?: ReactNode}) {
  const t = useT()
  return (
    <div className="broken-card" data-tone={tone} role="alert">
      <div className="broken-head">
        {tone === 'warn' ? <WarningOutline /> : <ErrorOutline />}
        <div>
          <strong>{title}</strong>
          <p>{text}</p>
          {body}
          <details open={devOpen}>
            <summary>{t('Developer info')}</summary>
            {dev}
          </details>
        </div>
      </div>
      {children && <div className="broken-actions">{children}</div>}
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

/**
 * An image or file field holding an asset this studio can't show (a Sanity export's
 * `_sanityAsset`, a Sanity asset id): shown as it is, read-only, never as an empty
 * field. Saves elsewhere leave it untouched; Reset is the only change offered.
 */
export function UnsupportedAssetCard({asset, value, onChange}: {asset: UnsupportedAsset; value: unknown; onChange: (v: unknown) => void}) {
  const t = useT()
  return (
    <Card
      tone="warn"
      title={t('Unsupported asset value')}
      text={t(asset.reason === 'sanityAsset' ? 'This field points to a file from an export that has not been uploaded to Barkpark. It is kept as it is.' : 'This field points to an asset Barkpark does not know. It is kept as it is.')}
      dev={
        <>
          <p className="broken-label">
            <code>{asset.source}</code>
          </p>
          <pre className="broken-value">{json(value)}</pre>
        </>
      }
    >
      <button type="button" className="btn broken-btn danger" onClick={() => onChange(undefined)}>
        {t('Reset value')}
      </button>
    </Card>
  )
}

/**
 * B14: a rich text field holding Sanity Portable Text (a Sanity export brought over).
 * The canvas can't edit it, so its text shows read-only, never an empty canvas; saves
 * elsewhere leave it untouched. It offers no action: Reset would delete the whole body
 * (task-3396abb1524c3045).
 */
export function SanityPortableTextCard({pt, value}: {pt: SanityPortableText; value: unknown}) {
  const t = useT()
  return (
    <Card
      tone="warn"
      title={t('Sanity Portable Text')}
      text={t('This field holds rich text from Sanity, which this studio cannot edit yet. Its text is shown below and kept as it is.')}
      body={
        <div className="broken-pt">
          {pt.lines.map((line, i) =>
            line.style === 'object' ? (
              <p key={i} className="broken-label">
                <code>{line.text}</code>
              </p>
            ) : /^h[1-6]$/.test(line.style) ? (
              <p key={i}>
                <strong>{line.text}</strong>
              </p>
            ) : (
              <p key={i}>{line.style === 'listItem' ? `• ${line.text}` : line.text}</p>
            ),
          )}
        </div>
      }
      dev={<pre className="broken-value">{json(value)}</pre>}
      devOpen={false}
    />
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
