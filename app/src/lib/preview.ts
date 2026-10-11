// J56, Sanity's preview `select` + `prepare`, declared instead of coded: a
// schema's `list_preview.subtitle` is a path ("author.name": one reference hop)
// or {parts, join, empty}. Each part is a path, optionally `|date` (dd.mm.yyyy);
// the parts that have a value are joined, and `empty` stands in when none do.
// Barkpark will format previews itself (task-f3203617ae4cf03e); until then the
// Studio reads the same declaration.

import {unsupportedAsset} from './broken.ts'
import {imageRef} from './image.ts'

export type PreviewText = string | {parts: string[]; join?: string; empty?: string}

const pathOf = (part: string) => part.split('|')[0]!.trim()

/** The reference fields a preview text reads through ("featuredPost" for "featuredPost.title"). */
export function previewRefs(spec: PreviewText | undefined): string[] {
  if (!spec) return []
  const parts = typeof spec === 'string' ? [spec] : spec.parts
  return [...new Set(parts.map(pathOf).filter((p) => p.includes('.')).map((p) => p.split('.')[0]!))]
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
export function formatPreview(spec: PreviewText | undefined, read: (path: string) => unknown): string | undefined {
  if (!spec) return undefined
  const one = (part: string) => {
    const v = read(pathOf(part))
    const text = part.includes('|date') ? day(v) : typeof v === 'string' || typeof v === 'number' ? String(v) : undefined
    return text?.trim() ? text : undefined
  }
  if (typeof spec === 'string') return one(spec)
  const shown = spec.parts.map(one).filter(Boolean)
  return shown.length ? shown.join(spec.join ?? ' · ') : spec.empty
}

/**
 * A row's media (list_preview.media): an image to show, an asset value the studio can't
 * show (a Sanity export's `_sanityAsset`, a Sanity asset id; task-ec9b4c0c78185fa4), or
 * none. The unsupported one draws a broken-image icon, not an empty box.
 */
export type PreviewMedia = {kind: 'image'; ref: string} | {kind: 'unsupported'; source: string} | {kind: 'none'}
export function previewMedia(value: unknown): PreviewMedia {
  const foreign = unsupportedAsset({name: 'media', type: 'image'}, value)
  if (foreign) return {kind: 'unsupported', source: foreign.source}
  const ref = imageRef(value)
  return ref ? {kind: 'image', ref} : {kind: 'none'}
}
