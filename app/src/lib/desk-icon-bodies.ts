/**
 * A desk tree (or its "…Rest" rows) with each named icon's SVG body as `iconSvg` ('' for a
 * name the table lacks), so the client draws them without the icon table: its 237 bodies
 * (96 KB) were in every page's first chunk (components/DeskIcon.tsx). The server passes
 * lib/desk-icons.json (server/schemas.ts).
 */
export function withIconBodies<T>(node: T, bodies: Record<string, string>): T {
  if (Array.isArray(node)) return node.map((n) => withIconBodies(n, bodies)) as T
  if (!node || typeof node !== 'object') return node
  const n = node as {icon?: unknown; items?: unknown}
  return {...node, ...(typeof n.icon === 'string' && {iconSvg: bodies[n.icon] ?? ''}), ...(Array.isArray(n.items) && {items: n.items.map((i) => withIconBodies(i, bodies))})}
}
