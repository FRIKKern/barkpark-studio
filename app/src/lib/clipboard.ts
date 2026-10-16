import type {Field} from './data'
import {toast} from '../components/Toasts'
import {t} from './i18n'

// Sanity's copy/paste (J29): "Copy field" / "Paste field" on a field's "…" menu,
// "Copy document" / "Paste document" on the document's, through the system clipboard
// in Sanity's format (below). A paste only lands where the schema types match, as in
// Sanity ("Invalid clipboard item").

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

// The system clipboard, in Sanity's format (task-11fcedbfe2d62bc8), so a copy pastes in
// another tab, window or browser and between Sanity and this studio, and copying anything
// else afterwards means "Nothing to paste" (the studio copy used to stay and paste stale).
// Sanity writes its item as JSON under a web custom type, again base64 in text/html (the
// browsers without custom types), and the words as text/plain. Ours rides along in the
// same item under `barkpark` (Sanity reads past keys it doesn't know), typed as ours.
export const SANITY_TYPE = 'web application/vnd.sanity-clipboard-item+json'

type SanityItem = {
  type: 'sanityClipboardItem'
  documentId?: string
  documentType?: string
  isDocument: boolean
  schemaTypeName: string
  valuePath: unknown[]
  value: unknown
  patchType: 'replace'
  barkpark?: Clip
}

/** Sanity's schema type name for one of our signatures (what decides whether its paste lands). */
const sanityTypeOf = (sig: string): string => (sig.startsWith('reference:') ? 'reference' : sig.startsWith('array:') ? 'array' : sig.startsWith('object:') ? 'object' : sig)

/** `doc`: the document it was copied from; Sanity refuses a field item without its type ("Invalid clipboard item"). */
function sanityItem(clip: Clip, doc?: {id?: string; type?: string}): SanityItem {
  const docId = doc?.id
  if (clip.kind === 'document')
    return {type: 'sanityClipboardItem', documentId: docId, documentType: clip.docType, isDocument: true, schemaTypeName: clip.docType, valuePath: [], value: {_type: clip.docType, ...Object.fromEntries(clip.fields.filter((f) => f.value !== undefined).map((f) => [f.name, f.value]))}, patchType: 'replace', barkpark: clip}
  return {type: 'sanityClipboardItem', documentId: docId, documentType: doc?.type, isDocument: false, schemaTypeName: sanityTypeOf(clip.field.sig), valuePath: [clip.field.name], value: clip.field.value, patchType: 'replace', barkpark: clip}
}

const toBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const fromBase64 = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)))
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!)

/**
 * Copy: the system clipboard (Sanity's three types); this browser keeps it too, only for a
 * browser that can't read it back. An empty value is refused with Sanity's warning and
 * leaves both clipboards as they were, so a later paste can't wipe a field.
 */
export async function copy(clip: Clip, doc?: {id?: string; type?: string}) {
  if (clip.kind === 'field' ? isEmpty(clip.field.append ? (clip.field.value as unknown[])[0] : clip.field.value) : clip.fields.every((f) => isEmpty(f.value))) return void toast({tone: 'caution', title: t('Empty value, nothing to copy')})
  try {
    localStorage.setItem(KEY, JSON.stringify(clip))
  } catch {
    /* private mode: the system clipboard still has it */
  }
  const text = clip.kind === 'field' ? asText(clip.field.value) : clip.fields.map((f) => asText(f.value)).filter(Boolean).join(', ')
  const json = JSON.stringify(sanityItem(clip, doc))
  const html = `<div data-sanity-clipboard-base64="${toBase64(json)}"><p>${escapeHtml(text)}</p></div>`
  const blob = (type: string, body: string) => new Blob([body], {type: type.replace(/^web /, '')})
  try {
    await navigator.clipboard.write([new ClipboardItem({[SANITY_TYPE]: blob(SANITY_TYPE, json), 'text/html': blob('text/html', html), 'text/plain': blob('text/plain', text)})])
  } catch {
    // A browser without web custom types: the item rides in text/html, as Sanity's does.
    await navigator.clipboard?.write?.([new ClipboardItem({'text/html': blob('text/html', html), 'text/plain': blob('text/plain', text)})]).catch(() => navigator.clipboard?.writeText(text).catch(() => {}))
  }
}

/** Copy item `i` of array `arrayId` (signature `sig`). */
export const copyItem = (arrayId: string, i: number, sig: string, item: unknown) => copy({kind: 'field', field: {name: `${arrayId}[${i}]`, sig, value: [item], append: true}})

/** An appended copy's items with fresh keys, so a paste into the array it came from adds a new row. */
export const rekeyed = (items: unknown[]) =>
  items.map((it) => (it && typeof it === 'object' && '_key' in it ? {...it, _key: crypto.randomUUID().replace(/-/g, '').slice(0, 12)} : it))

/** A Sanity item as one of ours: its own copy if it is ours, else what its value says. */
function fromSanity(item: SanityItem): Clip | null {
  if (item.barkpark && (item.barkpark.kind === 'field' || item.barkpark.kind === 'document')) return item.barkpark
  const sigOf = (type: string, value: unknown) =>
    ['string', 'text', 'url', 'email'].includes(type) ? 'string' : ['number', 'boolean', 'date', 'datetime'].includes(type) ? type : typeof value === 'string' && type === '' ? 'string' : `sanity:${type}`
  if (item.isDocument) {
    const value = (item.value ?? {}) as Record<string, unknown>
    const kind = (v: unknown) => (typeof v === 'string' ? 'string' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'sanity:object')
    return {kind: 'document', docType: item.documentType ?? item.schemaTypeName, fields: Object.entries(value).filter(([k]) => !k.startsWith('_')).map(([name, v]) => ({name, sig: kind(v), value: v}))}
  }
  const last = [...item.valuePath].reverse().find((p) => typeof p === 'string')
  return {kind: 'field', field: {name: typeof last === 'string' ? last : '', sig: sigOf(item.schemaTypeName, item.value), value: item.value}}
}

const parse = (json: string): SanityItem | null => {
  try {
    const item = JSON.parse(json) as SanityItem
    return item?.type === 'sanityClipboardItem' ? item : null
  } catch {
    return null
  }
}

/**
 * Paste: what the system clipboard holds now, ours or Sanity's; anything else is nothing
 * to paste. Only a browser that can't read the clipboard falls back to this browser's copy.
 */
export async function read(): Promise<Clip | null> {
  let items: ClipboardItems
  try {
    items = await navigator.clipboard.read()
  } catch (e) {
    // Refused outright (no clipboard API, or reading not allowed here): this browser's copy.
    if (!(e instanceof DOMException) || e.name === 'NotAllowedError' || !navigator.clipboard?.read) return readKept()
    return null
  }
  for (const it of items) {
    if (it.types.includes(SANITY_TYPE)) {
      const item = parse(await (await it.getType(SANITY_TYPE)).text())
      if (item) return fromSanity(item)
    }
    if (it.types.includes('text/html')) {
      const b64 = /data-sanity-clipboard-base64="([^"]+)"/.exec(await (await it.getType('text/html')).text())?.[1]
      const item = b64 ? parse(fromBase64(b64)) : null
      if (item) return fromSanity(item)
    }
  }
  return null
}

function readKept(): Clip | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Clip) : null
  } catch {
    return null
  }
}
