import {useState} from 'react'

// Barkpark field types Sanity doesn't have (B04), after Barkpark's LiveView Studio
// (api components/field_inputs.ex): a colour picker that can be unset, read-only
// views for JSON and source, and sane fallbacks so no value ever prints as
// "[object Object]". Codelists and localized text get their full editors in B05/B06.

/** Colour: native picker + hex + Clear; unset shows "No color" and a dimmed swatch (never a phantom #000000). */
export function ColorInput({id, value, onChange, readOnly}: {id: string; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined
  return (
    <div className="color-field">
      <input id={id} type="color" className="swatch" data-unset={!hex || undefined} value={hex ?? '#000000'} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />
      <span className="mono">{hex ?? 'No color'}</span>
      {hex && !readOnly && (
        <button type="button" className="btn btn-sm" onClick={() => onChange(undefined)}>
          Clear
        </button>
      )}
    </div>
  )
}

const pretty = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v, null, 2))

/** Structured values with no editor here (json, unknown shapes): pretty JSON, read-only, as LiveView shows them. */
export function ReadOnlyJson({id, value, note = 'read-only — managed via the API'}: {id: string; value: unknown; note?: string}) {
  return (
    <div className="readonly-view" id={id} data-readonly-field>
      <pre>{pretty(value)}</pre>
      <span className="muted">{note}</span>
    </div>
  )
}

/** Source: the raw text, verbatim and read-only (its source of truth lives elsewhere). */
export function SourceView({id, value}: {id: string; value: unknown}) {
  return (
    <div className="readonly-view source" id={id} data-readonly-field>
      <pre>{value == null || value === '' ? '—' : String(value)}</pre>
      <span className="muted">read-only — edited at its source, not in the Studio</span>
    </div>
  )
}

/** localizedText, simply: one box per declared language. B06 turns this into language tabs. */
export function LocalizedTextInput({id, languages, value, onChange, readOnly}: {id: string; languages: string[]; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const map = value && typeof value === 'object' ? (value as Record<string, string>) : {}
  const langs = languages.length ? languages : Object.keys(map)
  return (
    <div className="localized" id={id}>
      {langs.map((lang) => (
        <label key={lang} className="localized-row">
          <span className="lang">{lang}</span>
          <LocalText
            id={`${id}.${lang}`}
            value={map[lang] ?? ''}
            readOnly={readOnly}
            onChange={(text) => {
              const next = {...map, [lang]: text}
              if (!text) delete next[lang]
              onChange(Object.keys(next).length ? next : undefined)
            }}
          />
        </label>
      ))}
    </div>
  )
}

// Owns its text between renders like the form's TextInput, so fast typing never drops keys.
function LocalText({id, value, onChange, readOnly}: {id: string; value: string; onChange: (v: string) => void; readOnly?: boolean}) {
  const [local, setLocal] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) (setSeen(value), setLocal(value))
  return <textarea id={id} className="input" rows={2} value={local} readOnly={readOnly} onChange={(e) => (setLocal(e.target.value), onChange(e.target.value))} />
}

/** A codelist code, as text: Barkpark can't list a codelist's codes over HTTP yet (task-93b24f20348f6df0); B05 adds the picker. */
export function CodeInput({id, codelistId, value, onChange, readOnly}: {id: string; codelistId?: string; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const [text, setText] = useState(typeof value === 'string' ? value : '')
  const [seen, setSeen] = useState(value)
  if (value !== seen) (setSeen(value), setText(typeof value === 'string' ? value : ''))
  return (
    <div className="code-field">
      <input
        id={id}
        className="input mono"
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        // Barkpark stores one code: non-empty, no whitespace.
        onChange={(e) => {
          const v = e.target.value.replace(/\s/g, '')
          setText(v)
          onChange(v || undefined)
        }}
      />
      {codelistId && <span className="muted code-list">{codelistId}</span>}
    </div>
  )
}
