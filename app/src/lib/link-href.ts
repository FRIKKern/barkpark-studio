// J10: the addresses a link in the rich text field may carry: Barkpark's reader allowlist
// (the canvas's safe-url.js; Barkpark refuses the rest too): http, https, mailto, tel, a
// relative or in-document address, "#". A javascript:, data: or protocol-relative address
// is refused before it reaches the canvas.
const ALLOWED_SCHEME = /^(?:https?|mailto|tel):/i
const IN_DOC = /^(#|\?|\.\/|\.\.\/)/
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g

/** The address to link, cleaned, or null when it may not be linked. */
export function linkHref(raw: string): string | null {
  const href = raw.replace(CONTROLS, '').trim()
  if (!href) return null
  if (href.startsWith('/')) return /^\/[/\\]/.test(href) ? null : href
  return ALLOWED_SCHEME.test(href) || IN_DOC.test(href) ? href : null
}

/**
 * A stored link's address as the read view and Review changes may draw it: the allowlist
 * above, or undefined, and the link is drawn as its words (a javascript: or data: address
 * written by the API, an import or another client; task-b0b5853a3fb71864), as the canvas does.
 */
export const storedHref = (href: string | null | undefined) => (href ? (linkHref(href) ?? undefined) : undefined)
