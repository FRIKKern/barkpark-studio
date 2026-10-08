import type {Field} from './data'

// Sanity's copy/paste (J29): "Copy field" / "Paste field" on a field's "…" menu,
// "Copy document" / "Paste document" on the document's. The studio's own clipboard
// keeps the typed value (localStorage, so every pane and tab sees it); the system
// clipboard gets a plain-text version for pasting elsewhere. A paste only lands
// where the schema types match, as in Sanity ("Invalid clipboard item").

export type ClipField = {name: string; sig: string; value: unknown}
export type Clip = {kind: 'field'; field: ClipField} | {kind: 'document'; docType: string; fields: ClipField[]}

const KEY = 'studio.clipboard'

/** A field's type, reduced to what decides whether a value fits it. */
export function signature(f: Field): string {
  switch (f.type) {
    case 'string':
    case 'text':
    case 'url':
    case 'email':
    case 'select':
      return 'string'
    case 'reference':
      return `reference:${f.refType}`
    case 'arrayOf':
      return `array:${f.of ? signature(f.of) : '?'}`
    case 'composite':
      return `object:${(f.fields ?? []).map((s) => `${s.name}=${signature(s)}`).sort().join(',')}`
    default:
      return f.type
  }
}

/** Does `value` (copied as `sig`) fit field `f`? Select lists also need the value to be one of their options. */
export function fits(sig: string, value: unknown, f: Field): boolean {
  if (sig !== signature(f)) return false
  if (f.type !== 'select' || value == null) return true
  const raw = (Array.isArray(f.options) ? f.options : (f.options as {list?: unknown[]})?.list) ?? []
  return raw.some((o) => (o && typeof o === 'object' ? (o as {value: unknown}).value : o) === value)
}

const asText = (v: unknown): string =>
  v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.map(asText).filter(Boolean).join(', ') : Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([, x]) => asText(x)).filter(Boolean).join(', ')) : String(v)

export function copy(clip: Clip) {
  try {
    localStorage.setItem(KEY, JSON.stringify(clip))
  } catch {
    /* private mode: the system clipboard still gets the text */
  }
  const text = clip.kind === 'field' ? asText(clip.field.value) : clip.fields.map((f) => asText(f.value)).filter(Boolean).join(', ')
  void navigator.clipboard?.writeText(text).catch(() => {})
}

export function read(): Clip | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Clip) : null
  } catch {
    return null
  }
}
