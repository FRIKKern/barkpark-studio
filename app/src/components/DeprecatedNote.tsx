import {deprecatedId, deprecatedReason} from '../lib/deprecated'
import {useT} from '../lib/i18n'
import '../deprecated.css'

/**
 * Sanity's deprecated field header (FormFieldHeaderText, FormFieldSet): a caution "deprecated"
 * badge after the title and the reason in caution text on its own line under it. Drawn inside
 * the field's label or legend, after the title's own span, so a control's name stays the title
 * (Fields.tsx names it by that span); the reason describes the control instead (lib/field-aria.ts).
 */
export function DeprecatedNote({field, path}: {field: {deprecated?: unknown}; path: string}) {
  const t = useT()
  const reason = deprecatedReason(field)
  if (reason === undefined) return null
  return (
    <>
      <span className="deprecated-badge">{t('deprecated')}</span>
      {reason && (
        <span className="deprecated-reason" id={deprecatedId(path)}>
          {reason}
        </span>
      )}
    </>
  )
}
