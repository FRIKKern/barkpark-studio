import type {Field} from './data'
import {toast} from '../components/Toasts'
import {t} from './i18n'

// Sanity's copy/paste (J29): "Copy field" / "Paste field" on a field's "…" menu,
// "Copy document" / "Paste document" on the document's. The studio's own clipboard
// keeps the typed value (localStorage, so every pane and tab sees it); the system
// clipboard gets a plain-text version for pasting elsewhere. A paste only lands
// where the schema types match, as in Sanity ("Invalid clipboard item").

/** `append`: an array item, copied as Sanity does: a one-item list under its array's type, which a paste adds to the end. */
export type ClipField = {name: string; sig: string; value: unknown; append?: boolean}
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

/** Sanity's isEmptyValue: nothing, an empty list, or an object holding only its _key. */
export const isEmpty = (v: unknown) => v == null || (Array.isArray(v) ? v.length === 0 : typeof v === 'object' && Object.keys(v).join() === '_key')

/** An empty value is refused with Sanity's warning and leaves both clipboards as they were, so a later paste can't wipe a field. */
export function copy(clip: Clip) {
  if (clip.kind === 'field' ? isEmpty(clip.field.append ? (clip.field.value as unknown[])[0] : clip.field.value) : clip.fields.every((f) => isEmpty(f.value))) return void toast({tone: 'caution', title: t('Empty value, nothing to copy')})
  try {
    localStorage.setItem(KEY, JSON.stringify(clip))
  } catch {
    /* private mode: the system clipboard still gets the text */
  }
  const text = clip.kind === 'field' ? asText(clip.field.value) : clip.fields.map((f) => asText(f.value)).filter(Boolean).join(', ')
  void navigator.clipboard?.writeText(text).catch(() => {})
}

/** Copy item `i` of array `arrayId` (signature `sig`). */
export const copyItem = (arrayId: string, i: number, sig: string, item: unknown) => copy({kind: 'field', field: {name: `${arrayId}[${i}]`, sig, value: [item], append: true}})

/** An appended copy's items with fresh keys, so a paste into the array it came from adds a new row. */
export const rekeyed = (items: unknown[]) =>
  items.map((it) => (it && typeof it === 'object' && '_key' in it ? {...it, _key: crypto.randomUUID().replace(/-/g, '').slice(0, 12)} : it))

export function read(): Clip | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Clip) : null
  } catch {
    return null
  }
}
