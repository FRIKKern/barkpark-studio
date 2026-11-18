import {Fragment} from 'react'
import {convertedRef, strengthMismatch} from '../lib/refs'
import {useT} from '../lib/i18n'
import {WarningOutline} from './icons'
import '../ref-strength.css'

// Sanity's ReferenceStrengthMismatchAlertStrip (task-288f7978607cdc89): the stored reference is
// weak where the schema says strong, or strong where it says weak (a schema changed after the
// value was written, an import, a bare id in a weak field). Convert writes the schema's
// strength. A read-only form's disabled fieldset disables the button: looking writes nothing.

/** Sanity's `<em>` in its sentence, drawn as emphasis (the translation keeps the tags). */
const emphasised = (text: string) => text.split(/<em>(.*?)<\/em>/).map((part, i) => (i % 2 ? <em key={i}>{part}</em> : <Fragment key={i}>{part}</Fragment>))

export function RefStrength({stored, weak, onConvert}: {stored: unknown; weak: boolean | undefined; onConvert: (v: unknown) => void}) {
  const t = useT()
  const actual = strengthMismatch(stored, weak)
  if (!actual) return null
  return (
    <div className="ref-strength" role="alert" data-testid="alert-reference-strength-mismatch">
      <WarningOutline />
      <div className="ref-strength-body">
        <strong>{t('Reference strength mismatch')}</strong>
        <p>
          {emphasised(
            actual === 'weak'
              ? t('This reference is <em>weak</em>, but according to the current schema it should be <em>strong</em>.')
              : t('This reference is <em>strong</em>, but according to the current schema it should be <em>weak</em>.'),
          )}
        </p>
        <p>
          {actual === 'weak'
            ? t('This makes it possible to delete the referenced document without first deleting this reference, leaving this field referencing a nonexisting document.')
            : t('It will not be possible to delete the reference document without first removing this reference or converting it to weak.')}
        </p>
        <button type="button" className="ref-strength-btn" onClick={() => onConvert(convertedRef(stored, weak))}>
          {actual === 'weak' ? t('Convert to strong reference') : t('Convert to weak reference')}
        </button>
      </div>
    </div>
  )
}
