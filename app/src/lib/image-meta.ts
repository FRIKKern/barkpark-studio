// An image asset's size and blur placeholder (task-fd05a9327034f89c), read from what
// Barkpark keeps on its mediaAsset document: Sanity's `metadata` (dimensions, lqip, the
// palette) where the upload stored it, else the `fileInfo` every upload has (width,
// height, lqip). Pure, so node's tests load it.

export type ImageMeta = {width?: number; height?: number; lqip?: string; dominant?: string}

type Swatch = {background?: string}
export type RawImageAsset = {
  asset?: {
    fileInfo?: {width?: string; height?: string; lqip?: string}
    metadata?: {dimensions?: {width?: number; height?: number}; lqip?: string; palette?: {dominant?: Swatch | null}}
  }
}

const positive = (n: unknown) => (typeof n === 'number' && n > 0 ? n : typeof n === 'string' && Number(n) > 0 ? Number(n) : undefined)

/** Sanity's metadata first, then fileInfo; keys with nothing behind them are left out. */
export function imageMeta(raw: RawImageAsset): ImageMeta {
  const meta = raw.asset?.metadata
  const info = raw.asset?.fileInfo
  const out: ImageMeta = {
    width: positive(meta?.dimensions?.width) ?? positive(info?.width),
    height: positive(meta?.dimensions?.height) ?? positive(info?.height),
    lqip: meta?.lqip || info?.lqip || undefined,
    dominant: meta?.palette?.dominant?.background || undefined,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as ImageMeta
}

/** Sanity's "640 × 400", or undefined without both sides. */
export const sizeLabel = (m?: ImageMeta) => (m?.width && m.height ? `${m.width} × ${m.height}` : undefined)

/** The metadata kinds an image field asks the upload for (Sanity's `options.metadata`). */
export function uploadMeta(options: unknown): string[] {
  const list = (options && typeof options === 'object' && !Array.isArray(options) ? (options as {metadata?: unknown}).metadata : undefined)
  return Array.isArray(list) ? list.filter((m): m is string => m === 'exif' || m === 'location') : []
}
