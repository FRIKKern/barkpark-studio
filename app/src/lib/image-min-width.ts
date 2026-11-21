// An image field's `options.minWidth` (task-e1c90cb700ed5d62): HSO's Sanity rule (bildeMedAlt.ts)
// warns when the picked image is narrower, "Bildet er lite (under 1200 piksler bredt)…". Always
// a warning, never blocking Publish; no width known gives nothing (never a guess), and a vector
// image (SVG) has no pixel width to be short of. The width is the one reader's: the asset's
// /api/media/<id>/info (a Sanity id's own size first, then the asset's metadata, lib/image-meta).
// `options.minWidthMessage` is the field's own words; else the Studio's. Pure, so node's tests load it.
import {imageRef} from './image.ts'
import type {T} from './i18n'

/** What the studio knows of an asset: undefined while unknown (not read yet, or it failed). */
export type WidthOf = (ref: string) => {width?: number; mimeType?: string} | null | undefined

type Opts = {minWidth?: unknown; minWidthMessage?: unknown}
const minOf = (options: unknown) => {
  const n = (options as Opts | undefined)?.minWidth
  return typeof n === 'number' && n > 0 ? n : undefined
}

/** The warning for `value` on an image field with `options` (a field's, or an array member's), if it is narrower. */
export function narrowImage(type: string | undefined, options: unknown, value: unknown, widthOf: WidthOf | undefined, t: T): string | undefined {
  const min = type === 'image' ? minOf(options) : undefined
  const ref = min && widthOf ? imageRef(value) : undefined
  if (!ref) return undefined
  const info = widthOf!(ref)
  if (!info || info.mimeType === 'image/svg+xml' || /-svg$/i.test(ref)) return undefined
  const width = typeof info.width === 'number' && info.width > 0 ? info.width : undefined
  if (!width || width >= min!) return undefined
  const own = (options as Opts).minWidthMessage
  return typeof own === 'string' && own ? own : t('The image is under {minWidth} pixels wide. It may look blurry.', {minWidth: min!})
}

type BlockField = {name: string; title?: string; type: string; options?: unknown; of?: {type: string; options?: unknown}}
type BlockDecl = {name: string; title?: string; fields?: BlockField[]}

/**
 * The same warning for each image inside a rich-text field's blocks (HSO's «Bilde» block,
 * bildeblokk.bilder): a block whose `_type` names a declared `blocks.of` entry, its image fields
 * and its arrays of images. `block` is the block type's title, `title` its field's. Only this rule
 * looks inside rich text here; the rest stay Barkpark's findings there (lib/findings).
 */
export function narrowInBlocks(blocks: unknown, value: unknown, widthOf: WidthOf | undefined, t: T): {block: string; title: string; message: string}[] {
  const decls = ((blocks as {of?: unknown} | undefined)?.of ?? []) as BlockDecl[]
  if (!widthOf || !Array.isArray(value) || !Array.isArray(decls)) return []
  return value.flatMap((b) => {
    const decl = b && typeof b === 'object' ? decls.find((d) => d && d.name === (b as {_type?: unknown})._type && Array.isArray(d.fields)) : undefined
    return (decl?.fields ?? []).flatMap((f) => {
      const v = (b as Record<string, unknown>)[f.name]
      const said = f.of && Array.isArray(v) ? v.map((it) => narrowImage(f.of!.type, f.of!.options, it, widthOf, t)) : [narrowImage(f.type, f.options, v, widthOf, t)]
      return said.filter((m): m is string => !!m).map((message) => ({block: decl!.title ?? decl!.name, title: f.title ?? f.name, message}))
    })
  })
}
