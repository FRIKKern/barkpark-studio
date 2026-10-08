import {useContext, useRef, useState, type KeyboardEvent} from 'react'
import {EditPathContext} from './Fields'
import {useT} from '../lib/i18n'

// Barkpark field types Sanity doesn't have (B04), after Barkpark's LiveView Studio
// (api components/field_inputs.ex): a colour picker that can be unset, read-only
// views for JSON and source, and sane fallbacks so no value ever prints as
// "[object Object]". Codelists and localized text get their full editors in B05/B06.

/** Colour: native picker + hex + Clear; unset shows "No color" and a dimmed swatch (never a phantom #000000). */
export function ColorInput({id, value, onChange, readOnly}: {id: string; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const t = useT()
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined
  return (
    <div className="color-field">
      <input id={id} type="color" className="swatch" data-unset={!hex || undefined} value={hex ?? '#000000'} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />
      <span className="mono">{hex ?? t('No color')}</span>
      {hex && !readOnly && (
        <button type="button" className="btn btn-sm" onClick={() => onChange(undefined)}>
          {t('Clear')}
        </button>
      )}
    </div>
  )
}

const pretty = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v, null, 2))

/** Structured values with no editor here (json, unknown shapes): pretty JSON, read-only, as LiveView shows them. */
export function ReadOnlyJson({id, value, note}: {id: string; value: unknown; note?: string}) {
  const t = useT()
  return (
    <div className="readonly-view" id={id} data-readonly-field>
      <pre>{pretty(value)}</pre>
      <span className="muted">{note ?? t('read-only — managed via the API')}</span>
    </div>
  )
}

/** Source: the raw text, verbatim and read-only (its source of truth lives elsewhere). */
export function SourceView({id, value}: {id: string; value: unknown}) {
  const t = useT()
  return (
    <div className="readonly-view source" id={id} data-readonly-field>
      <pre>{value == null || value === '' ? '—' : String(value)}</pre>
      <span className="muted">{t('read-only — edited at its source, not in the Studio')}</span>
    </div>
  )
}

/** localizedText, simply: one box per declared language. B06 turns this into language tabs. */
/**
 * B06: one text per language, behind language tabs (one tab per `languages`
 * slot; a dot marks a slot that has text). The primary language is the first of
 * the field's `fallbackChain` (else the first slot), and the field opens on it.
 * As in the LiveView Studio, a missing primary with text in another language
 * says which fallback readers get. Tabs follow the ARIA pattern: arrows move,
 * Home/End jump, and only the selected tab is in the Tab order.
 */
export function LocalizedTextInput({id, languages, fallbackChain = [], value, onChange, readOnly}: {id: string; languages: string[]; fallbackChain?: string[]; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const t = useT()
  const map = value && typeof value === 'object' ? (value as Record<string, string>) : {}
  const langs = languages.length ? languages : Object.keys(map)
  const primary = fallbackChain.find((l) => langs.includes(l)) ?? langs[0]
  const [chosen, setChosen] = useState(primary)
  const editPath = useContext(EditPathContext)
  const lang = chosen && langs.includes(chosen) ? chosen : primary
  const tabs = useRef<HTMLDivElement>(null)
  // What readers get when the primary is empty: the chain's next filled slot, else any.
  const fallback = !map[primary ?? ''] ? [...fallbackChain, ...langs].find((l) => langs.includes(l) && map[l]) : undefined
  if (!lang) return <div className="localized" id={id} />

  const go = (i: number) => {
    const next = langs[(i + langs.length) % langs.length]!
    setChosen(next)
    requestAnimationFrame(() => tabs.current?.querySelector<HTMLElement>(`[data-lang="${next}"]`)?.focus())
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = langs.indexOf(lang)
    const to = ({ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: langs.length - 1} as Record<string, number>)[e.key]
    if (to === undefined) return
    e.preventDefault()
    go(to)
  }
  return (
    <div className="localized" id={id}>
      <div ref={tabs} className="lang-tabs" role="tablist" aria-labelledby={`${id}-label`} onKeyDown={onKey}>
        {langs.map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            id={`${id}-tab-${l}`}
            data-lang={l}
            aria-selected={l === lang}
            aria-controls={`${id}-panel`}
            tabIndex={l === lang ? 0 : -1}
            title={l === primary ? t('{lang} (primary)', {lang: l}) : l}
            onClick={() => setChosen(l)}
          >
            {l}
            {map[l] ? <span className="filled" aria-label={t(', has text')} /> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${lang}`}>
        <LocalText
          key={lang}
          id={`${id}.${lang}`}
          label={lang === primary ? t('{lang} (primary)', {lang}) : lang}
          value={map[lang] ?? ''}
          readOnly={readOnly}
          onChange={(text) => {
            // One path per language (empty unsets it): two editors on two languages both keep theirs.
            if (editPath) return editPath(`${id}.${lang}`, text)
            const next = {...map, [lang]: text}
            if (!text) delete next[lang]
            onChange(Object.keys(next).length ? next : undefined)
          }}
        />
      </div>
      {fallback && (
        <p className="localized-warning" role="status">
          {t('No {primary} text: readers get the {fallback} text instead.', {primary: primary ?? '', fallback})}
        </p>
      )}
    </div>
  )
}

// Owns its text between renders like the form's TextInput, so fast typing never drops keys.
function LocalText({id, label, value, onChange, readOnly}: {id: string; label: string; value: string; onChange: (v: string) => void; readOnly?: boolean}) {
  const [local, setLocal] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) (setSeen(value), setLocal(value))
  return <textarea id={id} className="input" rows={3} aria-label={label} value={local} readOnly={readOnly} onChange={(e) => (setLocal(e.target.value), onChange(e.target.value))} />
}

/** A codelist code as text: the fallback while a codelist can't be read (CodelistInput is the picker, B05). */
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
