// J56, Sanity's preview `select` + `prepare`, declared instead of coded: a
// schema's `list_preview.subtitle` is a path ("author.name": one reference hop)
// or {parts, join, empty}. Each part is a path, optionally `|date` (dd.mm.yyyy);
// the parts that have a value are joined, and `empty` stands in when none do.
// Barkpark will format previews itself (task-f3203617ae4cf03e); until then the
// Studio reads the same declaration.
//
// J33 array item previews read the same declaration, plus two things Sanity's
// prepare does there: a part may be a list of alternatives (the first with a
// value shows: ["title", "linkedDocument.title"]), and a part may be a template
// ('Knapp: "{buttonLabel}"'), shown only when every {path} in it has a value.
// `|type` shows a type name ("linkedDocument._type|type") as its schema title.

export type PreviewPart = string | string[]
export type PreviewText = string | {parts: PreviewPart[]; join?: string; empty?: string}
/** An image path, or alternatives in order ("backgroundImage", then "linkedDocument.cover"). */
export type PreviewMedia = string | string[]
export type PreviewOptions = {typeTitle?: (type: string) => string | undefined}

const pathOf = (part: string) => part.split('|')[0]!.trim()
const TEMPLATE = /\{([^{}]+)\}/g

/** Every path a preview text or media spec reads. */
function pathsOf(spec: PreviewText | PreviewMedia | undefined): string[] {
  if (!spec) return []
  const parts = typeof spec === 'string' ? [spec] : Array.isArray(spec) ? spec : spec.parts.flat()
  return parts.flatMap((p) => (p.includes('{') ? [...p.matchAll(TEMPLATE)].map((m) => pathOf(m[1]!)) : [pathOf(p)]))
}

/** The reference fields a preview text reads through ("featuredPost" for "featuredPost.title"). */
export function previewRefs(...specs: (PreviewText | PreviewMedia | undefined)[]): string[] {
  return [...new Set(specs.flatMap(pathsOf).filter((p) => p.includes('.')).map((p) => p.split('.')[0]!))]
}

/** A date or date-time as dd.mm.yyyy, the day it is in UTC (stable for every viewer). */
function day(v: unknown) {
  if (typeof v !== 'string') return undefined
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v)
  if (Number.isNaN(d.getTime())) return undefined
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
}

/** The preview text for a doc; `read` resolves a path (following one reference). */
export function formatPreview(spec: PreviewText | undefined, read: (path: string) => unknown, opts: PreviewOptions = {}): string | undefined {
  if (!spec) return undefined
  const value = (part: string) => {
    const v = read(pathOf(part))
    const text = part.includes('|date') ? day(v) : part.includes('|type') && typeof v === 'string' ? (opts.typeTitle?.(v) ?? v) : typeof v === 'string' || typeof v === 'number' ? String(v) : undefined
    return text?.trim() ? text : undefined
  }
  const template = (part: string) => {
    let missing = false
    const text = part.replace(TEMPLATE, (_, path: string) => value(path) ?? ((missing = true), ''))
    return missing ? undefined : text
  }
  const single = (part: string) => (part.includes('{') ? template(part) : value(part))
  const one = (part: PreviewPart) => (Array.isArray(part) ? part.map(single).find(Boolean) : single(part))
  if (typeof spec === 'string') return one(spec)
  const shown = spec.parts.map(one).filter(Boolean)
  return shown.length ? shown.join(spec.join ?? ' · ') : spec.empty
}

/** The first image a media spec finds: an image value, or the first image in an array of them. */
export function previewMedia(spec: PreviewMedia | undefined, read: (path: string) => unknown, isImage: (v: unknown) => boolean): unknown {
  for (const path of spec ? [spec].flat() : []) {
    const v = read(pathOf(path))
    const hit = Array.isArray(v) ? v.find(isImage) : isImage(v) ? v : undefined
    if (hit) return hit
  }
  return undefined
}
