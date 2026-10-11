import {useRouterState} from '@tanstack/react-router'

/** Sanity's perspective, from the URL: 'published' shows published versions read-only. */
export const usePublishedPerspective = () =>
  useRouterState({select: (s) => (s.location.search as {perspective?: string}).perspective === 'published'})

/**
 * J68: Sanity's "Inline changes" (?displayInlineChanges=true): a changed text field shows
 * what changed since publish. Sticky like the perspective (the router reads `true` as a boolean).
 */
export const useInlineChanges = () => useRouterState({select: (s) => String((s.location.search as {displayInlineChanges?: unknown}).displayInlineChanges) === 'true'})

/**
 * The perspective travels with navigation, as Sanity's does: an href without one
 * keeps the page's ?perspective=published; `perspective=drafts` is how a link asks
 * for drafts (the default, so it leaves the URL). Inline changes (J68) travel too.
 */
export function withPerspective(href: string, published: boolean, inline = false): string {
  const [path, query = ''] = href.split(/\?(.*)/s)
  const q = new URLSearchParams(query)
  if (q.get('perspective') === 'drafts') q.delete('perspective')
  else if (published && !q.has('perspective')) q.set('perspective', 'published')
  if (inline && !q.has('displayInlineChanges')) q.set('displayInlineChanges', 'true')
  const qs = q.toString()
  return qs ? `${path}?${qs}` : path!
}
