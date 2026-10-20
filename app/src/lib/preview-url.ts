import type {Doc} from './data'

// The desk.preview view's URL (components/PreviewView.tsx).

/** The doc's slug: Barkpark stores a string, Sanity-shaped data a {current}. */
export function slugOf(doc: Doc | null | undefined): string | undefined {
  const v = (doc as Record<string, unknown> | null | undefined)?.slug
  const slug = typeof v === 'string' ? v : (v as {current?: unknown} | undefined)?.current
  return typeof slug === 'string' && slug ? slug : undefined
}

/**
 * Where a preview template loads from: VITE_PREVIEW_ORIGIN_OVERRIDE, else the template's
 * own http(s) origin; null for a template with no origin and none configured, whose view
 * would load nothing (task-37691740e53e77b7: such a view is not offered).
 */
export function previewOrigin(template: string, origin = (import.meta.env?.VITE_PREVIEW_ORIGIN_OVERRIDE as string | undefined)): string | null {
  if (origin) return origin.replace(/\/$/, '')
  return /^https?:\/\/[^/]+/.exec(template)?.[0] ?? null
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

/**
 * The template a document's Preview view loads, or undefined for no view: the schema opts
 * in (desk.previewView) and its desk.preview template loads from somewhere.
 */
export function previewViewTemplate(schema: {preview?: string; previewView?: {title?: string}} | undefined, origin?: string): string | undefined {
  if (!schema?.previewView || !schema.preview) return undefined
  return previewOrigin(schema.preview, origin) ? schema.preview : undefined
}
