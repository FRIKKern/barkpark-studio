import type {Doc} from './data'

// The desk.preview view's URL (components/PreviewView.tsx).

/** The doc's slug: Barkpark stores a string, Sanity-shaped data a {current}. */
export function slugOf(doc: Doc | null | undefined): string | undefined {
  const v = (doc as Record<string, unknown> | null | undefined)?.slug
  const slug = typeof v === 'string' ? v : (v as {current?: unknown} | undefined)?.current
  return typeof slug === 'string' && slug ? slug : undefined
}

/**
 * The preview URL for a doc, or null when the template needs a slug the doc lacks.
 * VITE_PREVIEW_ORIGIN_OVERRIDE swaps the template's origin (the twin's templates say
 * :3102; a local site may run elsewhere).
 */
export function previewUrlOf(template: string, id: string, slug: string | undefined, origin = (import.meta.env?.VITE_PREVIEW_ORIGIN_OVERRIDE as string | undefined)): string | null {
  if (template.includes(':slug') && !slug) return null
  let url = template.replace(/:slug\b/g, encodeURIComponent(slug ?? '')).replace(/:id\b/g, encodeURIComponent(id))
  if (origin) url = url.replace(/^https?:\/\/[^/]+/, origin.replace(/\/$/, ''))
  return url
}
