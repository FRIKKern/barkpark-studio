// The studio's media proxy (routes/api/media/$id): which of Barkpark's transform
// parameters it passes on, when a transform falls back to the original, and what a
// response may be cached as. Pure, for the unit test.

/** Barkpark's image transform parameters the studio uses (docs/media/IMAGE-TRANSFORMS.md). */
const TRANSFORM = ['w', 'h', 'fit', 'auto', 'q'] as const

/** The transform part of a request's query, in a fixed order; '' when there is none. */
export function transformQuery(query: URLSearchParams): string {
  return new URLSearchParams(TRANSFORM.flatMap((k) => (query.has(k) ? [[k, query.get(k)!]] : []))).toString()
}

/**
 * A transform Barkpark cannot make (400: an SVG, TIFF or HEIC; 429: past the asset's
 * variant limit) is served as the original. A refusal of the reader (401, 403, 404) is
 * passed on as it is: the file read checks the reader's own token, and a second try
 * would not change that.
 */
export const fallsBackToOriginal = (status: number) => status === 400 || status === 429

/**
 * An asset's bytes never change under its id: a year, immutable, varying with Accept
 * (auto=format picks AVIF or WebP from it). A refusal is never kept, or a reader who
 * gains access later would still be shown it.
 */
export function mediaHeaders(ok: boolean, contentType: string): Record<string, string> {
  return ok ? {'content-type': contentType, 'cache-control': 'private, max-age=31536000, immutable', vary: 'Accept'} : {'content-type': contentType, 'cache-control': 'no-store'}
}
