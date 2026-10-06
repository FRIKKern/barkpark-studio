// An image field's value (schema-v2 "Stored value shapes"): the asset it points
// at, plus Sanity's hotspot and crop — all 0–1 fractions of the image — and any
// subfields it declares (alt) beside them.
export type Hotspot = {x: number; y: number; width: number; height: number}
export type Crop = {top: number; bottom: number; left: number; right: number}
export type ImageValue = {asset?: {_ref: string}; hotspot?: Hotspot; crop?: Crop} & Record<string, unknown>

// What Sanity writes the first time either is touched: the hotspot covers the
// whole image, nothing is cropped.
export const NO_HOTSPOT: Hotspot = {x: 0.5, y: 0.5, width: 1, height: 1}
export const NO_CROP: Crop = {top: 0, bottom: 0, left: 0, right: 0}

/** Where the studio serves an asset's bytes (routes/api/media/$id.ts). */
export const assetUrl = (ref: string) => `/api/media/${encodeURIComponent(ref.replace(/^asset-/, ''))}`

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
