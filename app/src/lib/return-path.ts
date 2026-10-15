// Where /login sends an editor once signed in (?redirect=): a path on this studio only.
// Anything else (another site, //host, a backslash a browser reads as a slash, the same
// hidden behind percent-encoding or control characters) goes to the structure instead,
// so a link to our sign-in screen can't hand a fresh session off to someone else's page.

export const HOME = '/structure'
const ORIGIN = 'http://studio.invalid'

/** `raw` when it is a path on this studio, else the structure. */
export function returnPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || /\s/.test(raw) || raw.length > 2048) return HOME
  // Each decoding of it must still be a plain path here: no //, no backslash, no controls.
  for (let s = raw, i = 0; ; i++) {
    if (i === 4 || /^\/\/|\\|[\u0000-\u001f\u007f-\u009f]/.test(s)) return HOME
    let next: string
    try {
      next = decodeURIComponent(s)
    } catch {
      return HOME
    }
    if (next === s) break
    s = next
  }
  try {
    return new URL(raw, ORIGIN).origin === ORIGIN ? raw : HOME
  } catch {
    return HOME
  }
}
