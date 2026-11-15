import {useT} from '../lib/i18n'
import {codeOf, languageTitle, type CodeOptions, type CodeValue} from '../lib/code-input'
import {codeDiffRows} from '../lib/code-diff'

const record = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as CodeValue) : undefined)

/**
 * Review changes for a code value: the language and filename from → to, and the code line
 * by line (removed lines struck, added ones marked, unchanged ones around them, the rest folded).
 */
export function CodeChanges({before, after, options = {}, by}: {before: unknown; after: unknown; options?: CodeOptions; by: (what: string) => string}) {
  const t = useT()
  const [was, now] = [record(before), record(after)]
  const attrs = (['language', 'filename'] as const).filter((k) => (was?.[k] ?? '') !== (now?.[k] ?? ''))
  const show = (k: 'language' | 'filename', v: CodeValue | undefined) => (k === 'language' ? languageTitle(v?.language, options) : v?.filename)
  const rows = codeDiffRows(codeOf(was).code, codeOf(now).code)
  const changed = rows.some((r) => r.kind === 'removed' || r.kind === 'added')
  const marks = (v: CodeValue | undefined) => codeOf(v).lines.join(', ')
  return (
    <div className="review-diff code-changes">
      {attrs.map((k) => (
        <p key={k} className="review-fromto">
          <span className="code-changes-name">{t(k === 'language' ? 'Language' : 'Filename')}</span>
          {show(k, was) && <del title={by('Removed')}>{show(k, was)}</del>}
          {show(k, was) && show(k, now) && <span className="review-arrow" aria-label={t('changed to')}>→</span>}
          {show(k, now) && <ins title={by('Added')}>{show(k, now)}</ins>}
        </p>
      ))}
      {changed && (
        <div className="code-diff" role="group" aria-label={t('Code')}>
          {rows.map((r, i) =>
            r.kind === 'skip' ? (
              <div key={i} className="code-diff-skip">
                {t('Unchanged lines: {count}', {count: r.count})}
              </div>
            ) : (
              <div key={i} className="code-diff-row" data-kind={r.kind}>
                <span className="code-diff-no" aria-hidden="true">{r.was ?? ''}</span>
                <span className="code-diff-no" aria-hidden="true">{r.now ?? ''}</span>
                {r.kind === 'removed' ? <del title={by('Removed')}>{r.text || ' '}</del> : r.kind === 'added' ? <ins title={by('Added')}>{r.text || ' '}</ins> : <span>{r.text || ' '}</span>}
              </div>
            ),
          )}
        </div>
      )}
      {marks(was) !== marks(now) && (
        <p className="review-fromto">
          <span className="code-changes-name">{t('Highlighted lines')}</span>
          {marks(was) && <del title={by('Removed')}>{marks(was)}</del>}
          {marks(was) && marks(now) && <span className="review-arrow" aria-label={t('changed to')}>→</span>}
          {marks(now) && <ins title={by('Added')}>{marks(now)}</ins>}
        </p>
      )}
    </div>
  )
}
