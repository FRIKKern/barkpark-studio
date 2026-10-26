// J56, Sanity's preview `select` + `prepare`, declared instead of coded: a
// schema's `list_preview.subtitle` is a path ("author.name" reads through a reference;
// up to five, as Barkpark's PreviewText: "parent.parent.title") or {parts, join, empty}. Each part is a path, optionally `|date` (dd.mm.yyyy);
// the parts that have a value are joined, and `empty` stands in when none do.
// Barkpark will format previews itself (task-f3203617ae4cf03e); until then the
// Studio reads the same declaration.
//
// J33 array item previews read the same declaration, plus two things Sanity's
// prepare does there: a part may be a list of alternatives (the first with a
// value shows: ["title", "linkedDocument.title"]), and a part may be a template
// ('Knapp: "{buttonLabel}"'), shown only when every {path} in it has a value.
// `|type` shows a type name ("linkedDocument._type|type") as its schema title.
//
// Barkpark's list_preview also takes object parts (Barkpark.Content.PreviewText,
// task-75cb2cac1e875214), read here the same way (task-afbd6fe5a5e2085b): {text}
// literal text, {when, show} a part shown while a visibleWhen condition holds, {path,
// map} a stored value by its label, a nested {parts} spec, and {each, show, max, join,
// more} a part read from each item of a list. `|lower` and `|upper` change the case, and
// `|count` shows the number of items in a list ("{packages|count} pakker").
// An `each` item that is a reference reads its target through `opts.deref`, which costs
// a hop; without `deref` it reads as nothing.

import {unsupportedAsset} from './broken.ts'
import {imageRef} from './image.ts'
import {matches, type Condition} from './conditions.ts'

type ObjectPart =
  | {text: string}
  | {when: Condition; show: PreviewPart}
  | {path: string; map: Record<string, string>}
  | {parts: PreviewPart[]; join?: string; empty?: string}
  | {each: string; show?: PreviewPart; max?: number; join?: string; more?: string}
export type PreviewPart = string | ObjectPart | PreviewPart[]
/** A part, a list of alternatives (the first with a value), or parts joined (barkpark docs/contracts/list-preview.md). */
export type PreviewText = string | PreviewPart[] | {parts: PreviewPart[]; join?: string; empty?: string}
/** An image path, or alternatives in order ("backgroundImage", then "linkedDocument.cover"). */
export type PreviewMediaSpec = string | string[]
export type PreviewOptions = {typeTitle?: (type: string) => string | undefined; deref?: (id: string) => unknown}

const pathOf = (part: string) => part.split('|')[0]!.trim()
const TEMPLATE = /\{([^{}]+)\}/g

/** Every path a part reads from the document (an `each` item's own paths are not). */
function partPaths(part: PreviewPart | undefined): string[] {
  if (part == null) return []
  if (typeof part === 'string') return part.includes('{') ? [...part.matchAll(TEMPLATE)].map((m) => pathOf(m[1]!)) : [pathOf(part)]
  if (Array.isArray(part)) return part.flatMap(partPaths)
  if (typeof part !== 'object') return []
  if ('parts' in part && Array.isArray(part.parts)) return part.parts.flatMap(partPaths)
  if ('when' in part) return partPaths(part.show)
  if ('map' in part && typeof part.path === 'string') return [pathOf(part.path)]
  if ('each' in part && typeof part.each === 'string') return [pathOf(part.each)]
  return []
}

/** Every path a preview text or media spec reads: plain, template, fallback and object parts alike. */
export function pathsOf(spec: PreviewText | PreviewMediaSpec | undefined): string[] {
  if (!spec) return []
  return typeof spec === 'string' || Array.isArray(spec) ? partPaths(spec) : partPaths(spec.parts)
}

/** The reference fields a preview text reads through ("featuredPost" for "featuredPost.title"). */
export function previewRefs(...specs: (PreviewText | PreviewMediaSpec | undefined)[]): string[] {
  return [...new Set(specs.flatMap(pathsOf).filter((p) => p.includes('.')).map((p) => p.split('.')[0]!))]
}

/** A date or date-time as dd.mm.yyyy, the day it is in UTC (stable for every viewer). */
/**
 * `|date` as dd.mm.yyyy. A plain date is that day; a date-time is the day it is where the
 * editor is, as Sanity's preview shows it (2026-10-08T23:30:00Z reads 09.10.2026 in Oslo).
 * Barkpark's LiveView still shows a date-time's UTC day (it has no editor zone).
 */
function day(v: unknown) {
  if (typeof v !== 'string') return undefined
  const pad = (n: number) => String(n).padStart(2, '0')
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (plain) return `${plain[3]}.${plain[2]}.${plain[1]}`
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return undefined
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

/** `|count`: the number of items in a list, `0` when the path holds nothing (Barkpark's PreviewText). */
const count = (v: unknown) => (Array.isArray(v) ? String(v.length) : v == null ? '0' : undefined)

/** The preview text for a doc; `read` resolves a path (`readPath` follows up to five references). */
export function formatPreview(spec: PreviewText | undefined, read: (path: string) => unknown, opts: PreviewOptions = {}): string | undefined {
  if (!spec) return undefined
  const value = (part: string) => {
    const v = read(pathOf(part))
    const mods = part.split('|').slice(1).map((m) => m.trim())
    const raw = mods.includes('count') ? count(v) : mods.includes('date') ? day(v) : mods.includes('type') && typeof v === 'string' ? (opts.typeTitle?.(v) ?? v) : typeof v === 'string' || typeof v === 'number' ? String(v) : undefined
    const text = raw && mods.includes('lower') ? raw.toLowerCase() : raw && mods.includes('upper') ? raw.toUpperCase() : raw
    return text?.trim() ? text : undefined
  }
  const template = (part: string) => {
    let missing = false
    const text = part.replace(TEMPLATE, (_, path: string) => value(path) ?? ((missing = true), ''))
    return missing ? undefined : text
  }
  // A `when` condition reads its field through `read`, set into a document of that shape.
  const holds = (c: Condition) => {
    const doc: Record<string, unknown> = {}
    const keys = c.field.split('.')
    keys.reduce<Record<string, unknown>>((o, k, i) => (o[k] = i === keys.length - 1 ? read(c.field) : {}) as Record<string, unknown>, doc)
    return matches({...c, scope: 'document'}, doc)
  }
  const one = (part: PreviewPart | undefined): string | undefined => {
    if (part == null) return undefined
    if (typeof part === 'string') return part.includes('{') ? template(part) : value(part)
    if (Array.isArray(part)) return part.map(one).find(Boolean)
    if (typeof part !== 'object') return undefined
    if ('parts' in part && Array.isArray(part.parts)) return formatPreview(part, read, opts)
    if ('text' in part) return typeof part.text === 'string' && part.text.trim() ? part.text : undefined
    if ('when' in part) return part.when && holds(part.when) ? one(part.show) : undefined
    if ('map' in part && typeof part.path === 'string') {
      const v = read(pathOf(part.path))
      if (typeof v !== 'string' && typeof v !== 'number') return undefined
      const label = part.map?.[String(v)] ?? String(v)
      return label.trim() ? label : undefined
    }
    if ('each' in part && typeof part.each === 'string') {
      const items = read(pathOf(part.each))
      if (!Array.isArray(items)) return undefined
      const show = part.show ?? 'title'
      const deref = opts.deref ?? (() => undefined)
      const texts = items
        .map((item) => {
          const id = crossedId(item)
          const root = id ? deref(id) : item
          if (!root || typeof root !== 'object') return undefined
          return formatPreview({parts: [show]}, (p) => readPath(root, p, deref, undefined, id ? MAX_HOPS - 1 : MAX_HOPS), opts)
        })
        .filter((t): t is string => !!t)
      const max = typeof part.max === 'number' && part.max > 0 ? part.max : undefined
      const shown = max ? texts.slice(0, max) : texts
      if (!shown.length) return undefined
      return shown.join(part.join ?? ', ') + (max && items.length > max ? (part.more ?? '') : '')
    }
    return undefined
  }
  if (typeof spec === 'string' || Array.isArray(spec)) return one(spec)
  const shown = spec.parts.map(one).filter(Boolean)
  return shown.length ? shown.join(spec.join ?? ' · ') : spec.empty
}

/** The first image a media spec finds: an image value, or the first image in an array of them. */
export function firstMedia(spec: PreviewMediaSpec | undefined, read: (path: string) => unknown, isImage: (v: unknown) => boolean): unknown {
  for (const path of spec ? [spec].flat() : []) {
    const v = read(pathOf(path))
    const hit = Array.isArray(v) ? v.find(isImage) : isImage(v) ? v : undefined
    if (hit) return hit
  }
  return undefined
}

/**
 * A row's media (list_preview.media): an image to show (a Sanity image id too, which
 * Barkpark serves), an http(s) image URL (a field of type url, which Barkpark's
 * list_preview contract takes as media; task-c74e7cdf5b119f87), an asset value the
 * studio can't show (a Sanity export's `_sanityAsset`, a ref that is no image id;
 * task-ec9b4c0c78185fa4), or none. The unsupported one draws a broken-image icon, not
 * an empty box.
 */
export type PreviewMedia = {kind: 'image'; ref: string} | {kind: 'url'; src: string} | {kind: 'unsupported'; source: string} | {kind: 'none'}

/** An absolute http(s) URL, trimmed; undefined for anything else (a path, `javascript:`, ''). */
export function mediaUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!/^https?:\/\//i.test(s)) return undefined
  try {
    return new URL(s).href
  } catch {
    return undefined
  }
}

export function previewMedia(value: unknown): PreviewMedia {
  const src = mediaUrl(value)
  if (src) return {kind: 'url', src}
  const foreign = unsupportedAsset({name: 'media', type: 'image'}, value)
  if (foreign) return {kind: 'unsupported', source: foreign.source}
  const ref = imageRef(value)
  if (ref) return {kind: 'image', ref}
  // An image that only holds a `url` (Barkpark's contract: "an image with url").
  const url = value && typeof value === 'object' ? mediaUrl((value as {url?: unknown}).url) : undefined
  return url ? {kind: 'url', src: url} : {kind: 'none'}
}

/** References a preview path crosses, at most (Barkpark's PreviewText @max_hops): a sixth reads as nothing, which also ends a cycle. */
export const MAX_HOPS = 5
/** A reference crossed mid-path: a {_ref}, or a bare id (Barkpark's contract takes both). */
const crossedId = (v: unknown): string | undefined =>
  typeof v === 'string' ? (/^[\w.-]+$/.test(v) ? v : undefined) : v && typeof v === 'object' && typeof (v as {_ref?: unknown})._ref === 'string' ? (v as {_ref: string})._ref : undefined

/**
 * The value at a dotted path (`heroImage.asset.url`, `parent.parent.title`). A reference
 * met before the path ends is read on in its target: `deref(id)` gives the target doc,
 * null when there is none, undefined while it is not loaded. Past `hops` references the
 * path reads as nothing. Every id it crosses or waits for goes to `seen`.
 */
export function readPath(doc: unknown, path: string, deref: (id: string) => unknown, seen?: Set<string>, hops = MAX_HOPS): unknown {
  let v = doc
  for (const key of path.split('.')) {
    const id = v === doc ? undefined : crossedId(v)
    if (id) {
      if (hops-- <= 0) return undefined
      seen?.add(id)
      v = deref(id)
      if (v == null) return undefined
    }
    v = v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined
  }
  return v
}

/** The documents a row's media paths read through (loaded ones and the ones still to load). */
export function mediaRefs(spec: PreviewMediaSpec | undefined, doc: unknown, deref: (id: string) => unknown = () => undefined): string[] {
  const seen = new Set<string>()
  for (const p of spec ? [spec].flat() : []) readPath(doc, pathOf(p), deref, seen)
  return [...seen]
}

/** The documents a text spec's paths read through, `each` items that are references too (Barkpark's PreviewText.ref_ids). */
export function textRefs(spec: PreviewText | undefined, doc: unknown, deref: (id: string) => unknown = () => undefined): string[] {
  const seen = new Set<string>()
  const walk = (part: PreviewPart | undefined, root: unknown, hops: number): void => {
    if (part == null) return
    if (Array.isArray(part)) return part.forEach((p) => walk(p, root, hops))
    if (typeof part === 'object' && 'parts' in part && Array.isArray(part.parts)) return walk(part.parts, root, hops)
    if (typeof part === 'object' && 'when' in part) return walk(part.show, root, hops)
    if (typeof part === 'object' && 'each' in part && typeof part.each === 'string') {
      const items = readPath(root, pathOf(part.each), deref, seen, hops)
      for (const item of Array.isArray(items) ? items : []) {
        const id = crossedId(item)
        if (!id) walk(part.show ?? 'title', item, hops)
        else if (hops > 0) {
          seen.add(id)
          walk(part.show ?? 'title', deref(id), hops - 1)
        }
      }
      return
    }
    if (root && typeof root === 'object') for (const p of partPaths(part)) readPath(root, p, deref, seen, hops)
  }
  if (spec) walk(typeof spec === 'string' || Array.isArray(spec) ? spec : spec.parts, doc, MAX_HOPS)
  return [...seen]
}

/**
 * Every document a page of rows reads through, one `load` per reference depth with all
 * of that depth's ids (Barkpark's PreviewText.targets/2): at most five loads, however
 * many rows. `refs()` names the ids the rows' paths cross so far, read again after each
 * load, so a loaded target names the next depth. An id is asked for once.
 */
export async function loadRefs(refs: () => string[], loaded: (id: string) => boolean, load: (ids: string[]) => Promise<unknown>) {
  const asked = new Set<string>()
  for (let depth = 0; depth < MAX_HOPS; depth++) {
    const ids = [...new Set(refs())].filter((id) => !asked.has(id) && !loaded(id))
    if (!ids.length) return
    for (const id of ids) asked.add(id)
    await load(ids)
  }
}

/**
 * Every media a row could show, in the spec's order: a path or a list of paths, each
 * dotted inside the document (`onix.thumbnail`), across references through `deref`
 * (`heroImage.asset.url`). A path that holds nothing (an empty URL) is skipped. The row
 * draws the first and moves to the next when an image URL fails to load.
 */
export function rowMedia(spec: PreviewMediaSpec | undefined, doc: unknown, deref: (id: string) => unknown = () => undefined): {path: string; value: unknown; media: PreviewMedia}[] {
  return (spec ? [spec].flat() : []).flatMap((p) => {
    const path = pathOf(p)
    const value = readPath(doc, path, deref)
    const media = previewMedia(value)
    return media.kind === 'none' ? [] : [{path, value, media}]
  })
}
