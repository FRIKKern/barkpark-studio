/**
 * A desk tree (or its "…Rest" rows) with each named icon's SVG body as `iconSvg` ('' for a
 * name the table lacks), so the client draws them without the icon table: its 237 bodies
 * (96 KB) were in every page's first chunk (components/DeskIcon.tsx). The server passes
 * lib/desk-icons.json (server/schemas.ts).
 */
export function withIconBodies<T>(node: T, bodies: Record<string, string>): T {
  if (Array.isArray(node)) return node.map((n) => withIconBodies(n, bodies)) as T
  if (!node || typeof node !== 'object') return node
  // iconSvg is drawn as markup: it only ever comes from the table, by an own key. One the
  // desk itself carries (it is content) is dropped, and `__proto__` or `constructor` is no name.
  const {iconSvg: _carried, ...rest} = node as {iconSvg?: unknown; icon?: unknown; items?: unknown}
  const svg = typeof rest.icon === 'string' ? (Object.hasOwn(bodies, rest.icon) ? bodies[rest.icon]! : '') : undefined
  return {...rest, ...(svg !== undefined && {iconSvg: svg}), ...(Array.isArray(rest.items) && {items: rest.items.map((i) => withIconBodies(i, bodies))})} as T
}
