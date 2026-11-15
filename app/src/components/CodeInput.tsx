import {lazy, Suspense, useContext, useEffect, useId, useRef, useState} from 'react'
import {DocIdContext, EditPathContext, FormDisabledContext, TextInput} from './Fields'
import {FieldClashCard} from './FieldClash'
import {ChevronDown} from './icons'
import {useT} from '../lib/i18n'
import type {Field} from '../lib/data'
import {CODE_LANGUAGES, codeDiffRows, codeLanguage, codeOf, codeOptions, codePreview, codeWrites, languageTitle, withCodeChange, type CodeChange, type CodeOptions, type CodeValue} from '../lib/code-input'

// The code field (Sanity's @sanity/code-input; lib/code-input.ts has the shape): a language
// picker, a filename when the schema asks for one, and the code in an editor that colours
// it, numbers its lines and highlights the ones clicked. The editor's chunk (CodeMirror)
// and each language's colouring load when a form first shows a code value. Each part saves
// to its own path, as a text field does, so two editors on the language and the code both
// keep theirs. Shut (a read seat, the published version, a revision) it shows the same
// code, coloured and selectable, and writes nothing.

const CodeEditor = lazy(() => import('./CodeEditor'))
const CodeStatic = lazy(() => import('./CodeEditor').then((m) => ({default: m.CodeStatic})))

const record = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as CodeValue) : undefined)

/** The editor's chunk is fetched in the browser only; until it lands the code shows as plain text. */
function useClient() {
  const [client, setClient] = useState(false)
  useEffect(() => setClient(true), [])
  return client
}

const AtRest = ({code}: {code: string}) => (
  <pre className="code-editor code-rest" data-loading="">
    {code}
  </pre>
)

export function CodeField({id, field, value, onChange, readOnly}: {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const t = useT()
  const editPath = useContext(EditPathContext)
  const shut = useContext(FormDisabledContext) || !!readOnly
  const docId = useContext(DocIdContext)
  const client = useClient()
  const hint = useId()
  const options = codeOptions(field)
  const stored = record(value)
  const {language, mode, languages} = codeLanguage(stored, options)
  const {code, lines} = codeOf(stored)
  // The value as this input last left it: two changes in one tick (code, and the highlights
  // it moved) build on each other, not both on the value a render old.
  const held = useRef(stored)
  held.current = stored
  const write = (change: CodeChange) => {
    if (shut) return
    const typeName = typeof held.current?._type === 'string' ? held.current._type : 'code'
    const next = withCodeChange(held.current, change, options, typeName)
    // Each part to its own path (lib/edits.ts); in a dialog that saves its value whole, the object.
    if (editPath) for (const [name, v] of codeWrites(held.current, change, options, typeName)) editPath(`${id}.${name}`, v)
    else onChange(next)
    held.current = next
  }
  // A stored language the list does not offer (an import's) stays, and shows as itself.
  const offered = languages.some((l) => l.value === language) ? languages : [...languages, {title: language, value: language}]
  const builtIn = languages === CODE_LANGUAGES
  return (
    <div className="fieldset code-input" id={id}>
      <div className="field">
        <label htmlFor={`${id}.language`}>{t('Language')}</label>
        <span className="select-box">
          <select id={`${id}.language`} className="input" value={language} disabled={shut} onChange={(e) => write({language: e.target.value})}>
            {offered.map((l) => (
              <option key={l.value} value={l.value}>
                {builtIn ? t(l.title) : l.title}
              </option>
            ))}
          </select>
          <ChevronDown />
        </span>
      </div>
      {options.withFilename && (
        <div className="field">
          <label htmlFor={`${id}.filename`}>{t('Filename')}</label>
          <TextInput id={`${id}.filename`} value={stored?.filename ?? ''} readOnly={shut} onChange={(v) => write({filename: String(v ?? '')})} />
        </div>
      )}
      <div className="field">
        <span className="label" id={`${id}.code-label`}>
          {t('Code')}
        </span>
        <FieldClashCard path={`${id}.code`} />
        <div className="code-box" data-readonly={shut || undefined}>
          {client ? (
            <Suspense fallback={<AtRest code={code} />}>
              {/* Another document, or the form shut or opened: a new editor, its own undo with it. */}
              <CodeEditor
                key={`${docId}:${shut}`}
                id={`${id}.code`}
                label={field.title ? `${field.title}: ${t('Code')}` : t('Code')}
                describedBy={shut ? undefined : hint}
                code={code}
                lines={lines}
                mode={mode}
                readOnly={shut}
                onCode={(text) => write({code: text})}
                onLines={(next) => write({highlightedLines: next})}
              />
            </Suspense>
          ) : (
            <AtRest code={code} />
          )}
        </div>
        {!shut && (
          <p className="field-note code-hint" id={hint}>
            {t('Tab indents; press Escape, then Tab, to move on. Click a line number, or press Ctrl+Alt+H, to highlight a line.')}
          </p>
        )}
      </div>
    </div>
  )
}

/** A code value on a card (a Portable Text block in the body): its filename and language, and the code coloured, read-only. */
export function CodeCard({value, options = {}}: {value: unknown; options?: CodeOptions}) {
  const t = useT()
  const client = useClient()
  const stored = record(value)
  const {mode} = codeLanguage(stored, options)
  const {code, lines} = codeOf(stored)
  if (!code) return <span className="code-card code-card-empty">{t('No code yet')}</span>
  return (
    <span className="code-card">
      {client ? (
        <Suspense fallback={<AtRest code={code} />}>
          <CodeStatic code={code} lines={lines} mode={mode} />
        </Suspense>
      ) : (
        <AtRest code={code} />
      )}
    </span>
  )
}

/** The line under a code card's or row's title: filename and language. */
export const codeCardLine = (value: unknown, options: CodeOptions = {}) => {
  const p = codePreview({...record(value), code: ''}, options)
  return [p.title, p.subtitle].filter(Boolean).join(' · ')
}

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
