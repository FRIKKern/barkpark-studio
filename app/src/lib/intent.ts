// Sanity's intent links (/intent/edit/id=…;type=…, /intent/create/type=…;template=…/<params>),
// as other tools and old bookmarks send them: read here, then opened in Structure.

export type Intent =
  | {action: 'edit'; id: string; type?: string}
  | {action: 'create'; type: string; template?: string; id?: string; params: Record<string, string>}

/** `edit/id=post-03;type=post`, `create/template=t;type=post/<base64url JSON>`; null if not an intent. */
export function parseIntent(splat: string): Intent | null {
  const [action, rawParams = '', payload] = splat.split('/')
  const params = Object.fromEntries(
    rawParams
      .split(';')
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf('=')
        return at < 0 ? [pair, ''] : [decodeURIComponent(pair.slice(0, at)), decodeURIComponent(pair.slice(at + 1))]
      }),
  ) as Record<string, string>
  if (action === 'edit' && params.id) return {action, id: params.id, ...(params.type ? {type: params.type} : {})}
  if (action === 'create' && params.type) return {action, type: params.type, ...(params.template ? {template: params.template} : {}), ...(params.id ? {id: params.id} : {}), params: payload ? decodePayload(payload) : {}}
  return null
}

/** The template parameters Sanity puts after the intent: base64url JSON. */
function decodePayload(payload: string): Record<string, string> {
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const value = JSON.parse(json) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {}
  } catch {
    return {}
  }
}
