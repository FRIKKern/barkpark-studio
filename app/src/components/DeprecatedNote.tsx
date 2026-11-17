import {useLayoutEffect, useRef} from 'react'
import {deprecatedIds, deprecatedReason, describeControl, noteParts} from '../lib/deprecated'
import {useT} from '../lib/i18n'
import '../deprecated.css'

/**
 * Sanity's deprecated field header (FormFieldHeaderText, FormFieldSet): a caution "deprecated"
 * badge after the title and the reason in caution text on its own line under it. Drawn inside
 * the field's label or legend, after the title, but out of the field's name (Sanity's label holds
 * the title alone): the badge and reason describe its control instead (lib/deprecated.ts).
 */
export function DeprecatedNote({field, path}: {field: {deprecated?: unknown}; path: string}) {
  const t = useT()
  const reason = deprecatedReason(field)
  const badge = useRef<HTMLSpanElement>(null)
  const ids = deprecatedIds(path, reason).join(' ')
  useLayoutEffect(() => (badge.current && ids ? describeControl(badge.current, ids.split(' ')) : undefined), [ids])
  if (reason === undefined) return null
  const parts = noteParts(path)
  return (
    <>
      <span ref={badge} className="deprecated-badge" {...parts.badge}>
        {t('deprecated')}
      </span>
      {reason && (
        <span className="deprecated-reason" {...parts.reason}>
          {reason}
        </span>
      )}
    </>
  )
}
