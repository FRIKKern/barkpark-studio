// An image field's value (schema-v2 "Stored value shapes"): the asset it points
// at, plus Sanity's hotspot and crop — all 0–1 fractions of the image — and any
// subfields it declares (alt) beside them.
export type Hotspot = {x: number; y: number; width: number; height: number}
export type Crop = {top: number; bottom: number; left: number; right: number}
export type ImageValue = {_type?: string; asset?: {_ref: string; _type?: string}; hotspot?: Hotspot; crop?: Crop} & Record<string, unknown>

// What Sanity writes the first time either is touched: the hotspot covers the
// whole image, nothing is cropped.
export const NO_HOTSPOT: Hotspot = {x: 0.5, y: 0.5, width: 1, height: 1}
export const NO_CROP: Crop = {top: 0, bottom: 0, left: 0, right: 0}

/** Where the studio serves an asset's bytes (routes/api/media/$id.ts). */
/**
 * The image's asset ref, from Sanity's canonical value {_type: 'image', asset: {_type:
 * 'reference', _ref}} (what a new pick stores) or the bare {asset: {_ref}} older content
 * holds (read as it is, never rewritten). Barkpark still
 * reads the legacy {assetId, url} shape (docs/contracts/schema-v2.md), which
 * migrated content such as the Agency twin's 955 images carries. So does this.
 */
export const imageRef = (v: unknown): string | undefined => {
  const o = (v && typeof v === 'object' ? v : {}) as {asset?: {_ref?: string}; assetId?: unknown}
  return o.asset?._ref ?? (typeof o.assetId === 'string' && o.assetId ? `asset-${o.assetId}` : undefined)
}
/** Keys of the legacy shape a new asset replaces (they would point at the old one). */
export const LEGACY_IMAGE_KEYS = ['assetId', 'url', 'lqip', 'width', 'height', 'focalX', 'focalY'] as const

/**
 * The name a body image card shows (Sanity: its asset's file name), as Barkpark's canvas
 * names it (image-node.js imageFileName): a Barkpark media URL loses the 8 hex its stored
 * name carries (`<slug>-<8 hex>.<ext>`), any other URL shows its last segment.
 */
export function imageFileName(src: string | undefined, alt: string | undefined, fallback: string): string {
  let name = ''
  if (src && !/^(data|blob):/i.test(src)) {
    name = src.split(/[?#]/)[0]!.split('/').pop() ?? ''
    try {
      name = decodeURIComponent(name)
    } catch {}
    if (/\/media\/files\//.test(src)) name = name.replace(/-[0-9a-f]{8}(\.[A-Za-z0-9]{1,16})?$/, '$1')
  }
  return name || alt || fallback
}

/**
 * The value to store for a newly picked asset: Sanity's canonical shape, {_type: 'image',
 * asset: {_type: 'reference', _ref}}, as our file field stores {_type: 'file', …}. Content
 * in the legacy shape (migrated twins read `url` on their site) keeps that shape alongside
 * the ref, so the site still finds the file. Only a pick writes this: an image left alone
 * keeps whatever shape it has (no rewrite, no surprise diff).
 */
export function pickedImage(prev: Record<string, unknown>, ref: string, url?: string): Record<string, unknown> {
  const {hotspot: _h, crop: _c, ...keep} = prev
  const legacy = typeof prev.assetId === 'string' || typeof prev.url === 'string'
  for (const k of LEGACY_IMAGE_KEYS) delete keep[k]
  if (legacy) return url ? {...keep, asset: {_ref: ref}, assetId: ref.replace(/^asset-/, ''), url} : {...keep, asset: {_ref: ref}}
  return {...keep, _type: 'image', asset: {_type: 'reference', _ref: ref}}
}

export const assetUrl = (ref: string) => `/api/media/${encodeURIComponent(ref.replace(/^asset-/, ''))}`

export type SanityImageId = {sha1: string; width: number; height: number; ext: string}
const SANITY_IMAGE_ID = /^image-([0-9a-f]{40})-([1-9][0-9]*)x([1-9][0-9]*)-([a-z0-9]+)$/i
/**
 * A Sanity image id, `image-<sha1>-<w>x<h>-<ext>`, as a value moved over from Sanity holds it.
 * Barkpark serves it from its Sanity image route, which finds the media file by the id or
 * by the sha1 of its bytes (routes/api/media/$id). Null for any other ref.
 */
export function sanityImageId(ref: unknown): SanityImageId | null {
  const m = typeof ref === 'string' ? SANITY_IMAGE_ID.exec(ref) : null
  return m ? {sha1: m[1]!.toLowerCase(), width: Number(m[2]), height: Number(m[3]), ext: m[4]!.toLowerCase()} : null
}
/**
 * Barkpark's path for a Sanity image id, under the workspace and project prefix:
 * `/images/<projectId>/<dataset>/<sha1>-<w>x<h>.<ext>`. Barkpark ignores the projectId
 * segment (the prefix names the tenant), so the studio sends `barkpark`, as Barkpark's
 * own Studio does (FieldInputs.sanity_image_url).
 */
export const sanityImagePath = (id: SanityImageId, dataset: string) => `/images/barkpark/${encodeURIComponent(dataset)}/${id.sha1}-${id.width}x${id.height}.${id.ext}`

/**
 * An image at the size it shows (CSS px times 2 for a sharp screen), as AVIF or WebP when
 * the browser takes it: Barkpark's transform, fit inside w x h, never scaled up past the
 * original. A row thumbnail was the 320 px JPEG preset and a field preview the original
 * (510 KB for an 1800 px PNG shown at 324 px).
 */
export const imageSrc = (ref: string, w: number, h = w) => `${assetUrl(ref)}?w=${w}&h=${h}&fit=max&auto=format`
/** A row's 33 px (73 px detailed) square, cut from the image in CSS around the hotspot. */
export const THUMB_PX = 240
/** A media tile (about 150 x 110 px) or the image picker's grid. */
export const TILE_PX = 320

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number) => Math.round(v * 1e6) / 1e6
/** The smallest hotspot or crop side, as a fraction of the image. */
export const MIN = 0.05

/** Move the hotspot by (dx, dy), keeping the whole ellipse on the image. */
export function moveHotspot(h: Hotspot, dx: number, dy: number): Hotspot {
  return {...h, x: round(clamp(h.x + dx, h.width / 2, 1 - h.width / 2)), y: round(clamp(h.y + dy, h.height / 2, 1 - h.height / 2))}
}

/** Resize the hotspot around its centre: its handle follows a drag of (dx, dy), as in Sanity. */
export function resizeHotspot(h: Hotspot, dx: number, dy: number): Hotspot {
  const width = clamp(h.width + 2 * dx, MIN, 2 * Math.min(h.x, 1 - h.x))
  const height = clamp(h.height + 2 * dy, MIN, 2 * Math.min(h.y, 1 - h.y))
  return {...h, width: round(width), height: round(height)}
}

/**
 * The hotspot kept inside the crop, as Sanity's tool keeps it: narrowed to the crop's size
 * and moved in. A crop pulled across it (or a hotspot moved or grown past the crop's edge)
 * stored a hotspot partly outside what the image shows.
 */
export function fitHotspot(h: Hotspot, c: Crop): Hotspot {
  const [l, r, t, b] = [c.left, 1 - c.right, c.top, 1 - c.bottom]
  const width = Math.min(h.width, r - l)
  const height = Math.min(h.height, b - t)
  const x = clamp(h.x, l + width / 2, r - width / 2)
  const y = clamp(h.y, t + height / 2, b - height / 2)
  return x === h.x && y === h.y && width === h.width && height === h.height ? h : {...h, x: round(x), y: round(y), width: round(width), height: round(height)}
}

/** Move the whole crop window by (dx, dy), keeping its size and staying on the image. */
export function moveCrop(c: Crop, dx: number, dy: number): Crop {
  const ddx = clamp(dx, -c.left, c.right)
  const ddy = clamp(dy, -c.top, c.bottom)
  return {left: round(c.left + ddx), right: round(c.right - ddx), top: round(c.top + ddy), bottom: round(c.bottom - ddy)}
}

export type CropSide = 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

/** Drag one side (or corner) of the crop to the point (px, py); the window keeps a minimum size. */
export function dragCrop(c: Crop, side: CropSide, px: number, py: number): Crop {
  const out = {...c}
  if (/^top/.test(side)) out.top = round(clamp(py, 0, 1 - c.bottom - MIN))
  if (/^bottom/.test(side)) out.bottom = round(clamp(1 - py, 0, 1 - c.top - MIN))
  if (/left$/i.test(side)) out.left = round(clamp(px, 0, 1 - c.right - MIN))
  if (/right$/i.test(side)) out.right = round(clamp(1 - px, 0, 1 - c.left - MIN))
  return out
}

/**
 * The part of the image a frame of aspect `ratio` (w/h) shows: the crop, cut
 * down to the ratio around the hotspot's centre (as Sanity's image URLs do).
 * In 0–1 fractions of the image; `natural` is the image's pixel size.
 */
export function frame(c: Crop, h: Hotspot, natural: {width: number; height: number}, ratio: number) {
  const cw = (1 - c.left - c.right) * natural.width
  const ch = (1 - c.top - c.bottom) * natural.height
  let w = cw
  let hgt = ch
  if (cw / ch > ratio) w = ch * ratio
  else hgt = cw / ratio
  const left = clamp(h.x * natural.width - w / 2, c.left * natural.width, c.left * natural.width + cw - w)
  const top = clamp(h.y * natural.height - hgt / 2, c.top * natural.height, c.top * natural.height + ch - hgt)
  return {left: left / natural.width, top: top / natural.height, width: w / natural.width, height: hgt / natural.height}
}
