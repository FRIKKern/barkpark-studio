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

/** Raster images, video and audio: what an <img>, <video> or <audio> shows, and no page can run. */
const PASSIVE = /^(image\/(png|jpeg|gif|webp|avif|bmp|tiff|heic|heif|x-icon|vnd\.microsoft\.icon)|video\/[\w.+-]+|audio\/[\w.+-]+)$/

/** The policy a directly opened file runs under: no script, no fetches, a unique origin (Barkpark's own for SVG). */
export const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox"

/**
 * The safety headers on a user-uploaded file served from the studio's origin
 * (task-71cb73cb5f89acef). Barkpark sends its own (an SVG gets a sandbox CSP, html
 * and the like are octet-stream attachments) but this proxy rebuilt the headers from
 * content-type alone, so an uploaded SVG opened at /api/media/<id> ran its script
 * here, with the editor's session. Now:
 *  - every file: nosniff;
 *  - a raster image, video or audio: nothing more;
 *  - a PDF: inline, for the browser's viewer (it runs no script on this origin, and
 *    a sandbox CSP would stop Chrome from showing it);
 *  - an SVG: the sandbox CSP, so an <img> still draws it and a direct open runs
 *    nothing; opened as a page (Sec-Fetch-Dest: document) it is also a download;
 *  - anything else: the sandbox CSP and a download.
 */
export function fileSafetyHeaders(contentType: string, dest?: string | null): Record<string, string> {
  const type = contentType.split(';')[0].trim().toLowerCase()
  const nosniff = {'x-content-type-options': 'nosniff'}
  if (PASSIVE.test(type) || type === 'application/pdf') return nosniff
  if (type === 'image/svg+xml' && dest !== 'document') return {...nosniff, 'content-security-policy': FILE_CSP}
  return {...nosniff, 'content-security-policy': FILE_CSP, 'content-disposition': 'attachment'}
}

/**
 * An asset's bytes never change under its id: a year, immutable, varying with Accept
 * (auto=format picks AVIF or WebP from it) and Sec-Fetch-Dest (an SVG opened as a page
 * downloads). A refusal is never kept, or a reader who gains access later would still be
 * shown it. A refusal is Barkpark's own error body, not an uploaded file: nosniff only.
 */
export function mediaHeaders(ok: boolean, contentType: string, dest?: string | null): Record<string, string> {
  return ok
    ? {'content-type': contentType, 'cache-control': 'private, max-age=31536000, immutable', vary: 'Accept, Sec-Fetch-Dest', ...fileSafetyHeaders(contentType, dest)}
    : {'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}
}
