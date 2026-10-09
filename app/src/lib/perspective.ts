import {useRouterState} from '@tanstack/react-router'

/** Sanity's perspective, from the URL: 'published' shows published versions read-only. */
export const usePublishedPerspective = () =>
  useRouterState({select: (s) => (s.location.search as {perspective?: string}).perspective === 'published'})

/**
 * The perspective travels with navigation, as Sanity's does: an href without one
 * keeps the page's ?perspective=published; `perspective=drafts` is how a link asks
 * for drafts (the default, so it leaves the URL).
 */
export function withPerspective(href: string, published: boolean): string {
  const [path, query = ''] = href.split(/\?(.*)/s)
  const q = new URLSearchParams(query)
  if (q.get('perspective') === 'drafts') q.delete('perspective')
  else if (published && !q.has('perspective')) q.set('perspective', 'published')
  const qs = q.toString()
  return qs ? `${path}?${qs}` : path!
}
