// J54, Sanity's file field: which files a field accepts (its `options.accept`,
// the <input accept> grammar), and how sizes and types read (Sanity's wording).

/** Does a file match an accept list ("application/pdf", ".pdf", "image/*", comma separated)? None given: anything. */
export function accepts(accept: string | undefined, file: {name: string; type: string}): boolean {
  const rules = (accept ?? '').split(',').map((r) => r.trim().toLowerCase()).filter(Boolean)
  if (!rules.length) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return rules.some((r) => (r.startsWith('.') ? name.endsWith(r) : r.endsWith('/*') ? type.startsWith(r.slice(0, -1)) : type === r))
}

/**
 * While a file is dragged the browser shows its type, not its name: an
 * extension rule (".pdf") can't be judged yet, so it counts as a maybe.
 */
export function mayAccept(accept: string | undefined, type: string): boolean {
  const rules = (accept ?? '').split(',').map((r) => r.trim()).filter(Boolean)
  return !type || !rules.length || rules.some((r) => r.startsWith('.')) || accepts(accept, {name: '', type})
}

/** A file in the media library, as a file field shows and picks it. */
export type FileAsset = {id: string; name: string; size: number; mimeType: string; createdAt: string}

/** The field row's size: "99 Bytes", "2.37 MB" (Sanity's formatBytes, 1024-based). */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 Bytes'
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
  return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${sizes[i]}`
}

/** The picker's size column: "99 byte", "2.48 MB" (Sanity's getHumanFriendlyBytes, 1000-based, Intl units; B01: in the Studio's language). */
export function humanBytes(bytes: number, locale: 'en' | 'nb-NO' = 'en'): string {
  const [n, unit] = bytes < 1e3 ? [bytes, 'byte'] : bytes < 1e6 ? [bytes / 1e3, 'kilobyte'] : bytes < 1e9 ? [bytes / 1e6, 'megabyte'] : [bytes / 1e9, 'gigabyte']
  return new Intl.NumberFormat(locale === 'nb-NO' ? 'nb-NO' : 'en-US', {style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 2}).format(n)
}

const MIME: Record<string, string> = {
  'application/pdf': 'PDF Document',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'application/zip': 'ZIP Archive',
  'application/xml': 'XML Document',
  'text/xml': 'XML Document',
  'application/octet-stream': 'Binary',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel Spreadsheet',
  'application/vnd.ms-excel': 'Excel Spreadsheet',
  'image/png': 'PNG Image',
  'image/jpeg': 'JPEG Image',
  'video/webm': 'WebM Video',
  'video/mp4': 'MP4 Video',
}
/** The picker's type column: "PDF Document", "Text"; otherwise the subtype, capitalised (Sanity's formatMimeType). */
export function mimeTitle(mime: string | undefined): string {
  if (!mime) return ''
  if (MIME[mime]) return MIME[mime]
  const part = mime.replace('x-', '').split('/')[1] ?? mime
  return part.charAt(0).toUpperCase() + part.slice(1)
}

/** "just now", "1 minute ago", "23 hours ago", for the picker's date column (Sanity's; B01: "for 1 minutt siden" in Norwegian). */
export function ago(iso: string, now = Date.now(), locale: 'en' | 'nb-NO' = 'en'): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000)
  if (s < 60) return locale === 'nb-NO' ? 'akkurat nå' : 'just now'
  const rtf = new Intl.RelativeTimeFormat(locale === 'nb-NO' ? 'nb' : 'en', {numeric: 'auto'})
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]] as const)
    if (Math.abs(s) >= size) return rtf.format(-Math.floor(s / size), unit)
  return rtf.format(-s, 'second')
}
