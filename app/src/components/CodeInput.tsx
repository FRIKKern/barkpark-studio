import {useContext, useId, useRef} from 'react'
import {DocIdContext, EditPathContext, FormDisabledContext, TextInput} from './Fields'
import {FieldClashCard} from './FieldClash'
import {ChevronDown} from './icons'
import CodeEditor from './CodeEditor'
import {useT} from '../lib/i18n'
import type {Field} from '../lib/data'
import {CODE_LANGUAGES, codeLanguage, codeOf, codeOptions, codeWrites, withCodeChange, type CodeChange, type CodeValue} from '../lib/code-input'

// The code field (Sanity's @sanity/code-input; lib/code-input.ts has the shape): a language
// picker, a filename when the schema asks for one, and the code in an editor that colours
// it, numbers its lines and highlights the ones clicked. This file and the editor
// (CodeEditor.tsx, CodeMirror) are a chunk of their own, fetched when a form first shows a
// code field (CodeField.tsx); each language's colouring is fetched when first shown. Each
// part saves to its own path, as a text field does, so two editors on the language and the
// code both keep theirs. Shut (a read seat, the published version, a revision) it shows the
// same code, coloured and selectable, and writes nothing.

const record = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as CodeValue) : undefined)

export default function CodeInput({id, field, value, onChange, readOnly}: {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const t = useT()
  const editPath = useContext(EditPathContext)
  const shut = useContext(FormDisabledContext) || !!readOnly
  const docId = useContext(DocIdContext)
  const hint = useId()
  const options = codeOptions(field)
  const stored = record(value)
  const {language, mode, languages} = codeLanguage(stored, options)
  const {code, lines} = codeOf(stored)
  // The value as this input last left it: two changes in one tick (code, and the highlights
  // it moved) build on each other, not both on the value a render old.
  // In a dialog the value comes back a render later, sometimes an older one of this input's
  // own first: only a value this input did not make replaces what it holds.
  const held = useRef(stored)
  const mine = useRef(new WeakSet<object>())
  if (!stored || !mine.current.has(stored)) held.current = stored
  const write = (change: CodeChange) => {
    if (shut) return
    const typeName = typeof held.current?._type === 'string' ? held.current._type : 'code'
    const next = withCodeChange(held.current, change, options, typeName)
    // Each part to its own path (lib/edits.ts); in a dialog that saves its value whole, the object.
    if (editPath) for (const [name, v] of codeWrites(held.current, change, options, typeName)) editPath(`${id}.${name}`, v)
    else onChange(next)
    mine.current.add(next)
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
