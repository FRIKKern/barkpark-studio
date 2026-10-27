import type {Template} from './plugins'

// A template named by a URL (a new document's `template=…,<params>`, an intent link). A URL is
// anyone's input, so only a template for the pane's own type is used; its parameters reach only
// its own function, by the names it declares and as strings; no system field (`_id`, `_type`,
// `_rev`, …) comes from a template or its parameters. Anything else gives none: the pane then
// says the document was not found, as with any id Barkpark doesn't have.

export type Resolved = {id: string; title: string; type: string; value: Record<string, unknown>; params?: Record<string, string>}

const plain = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_'))) : {}

export function resolveTemplate(templates: Template[], own: (type: string) => {title: string; value: Record<string, unknown>} | undefined, type: string, id: string, params?: Record<string, string>): Resolved | undefined {
  // The type's own way to start (its initial values): the template id is the type.
  if (id === type) {
    const o = own(type)
    return o && {id, title: o.title, type, value: plain(o.value)}
  }
  const t = templates.find((x) => x.id === id)
  if (!t || t.schemaType !== type) return undefined
  if (!t.parameters) return {id, title: t.title, type, value: plain(t.value)}
  const clean: Record<string, string> = {}
  for (const name of t.parameters) {
    const v = params?.[name]
    if (typeof v !== 'string') return undefined
    clean[name] = v
  }
  try {
    return {id, title: t.title, type, value: plain(t.value(clean)), params: clean}
  } catch {
    return undefined
  }
}
