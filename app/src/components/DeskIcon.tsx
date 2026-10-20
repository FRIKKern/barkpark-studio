// B12: the icons a desk row names, as Sanity draws them (@sanity/icons, MIT, see THIRD-PARTY.md).
// Keyed by Sanity's icon names; an unknown name shows no icon.
// task-af038d8b0d769e82: every @sanity/icons 5.2.3 name (MIT), plus lucide's `library`
// (ISC), the same vocabulary Barkpark's LiveView Studio draws (barkpark priv/desk_icons.json,
// vendored as lib/desk-icons.json). Before, 12 names drew and the rest showed nothing.
import ICONS from '../lib/desk-icons.json'

const BODIES: Record<string, string> = ICONS

/** An icon's SVG body (25×25 viewBox), by name; Sanity's DocumentIcon when it has none. */
export const iconBody = (name?: string) => (name && BODIES[name]) || BODIES.document!

/** A desk icon by name, or null. The SVG bodies are fixed strings from @sanity/icons, never user input. */
export function DeskIcon({name}: {name?: string}) {
  const body = name ? BODIES[name] : undefined
  if (!body) return null
  return <svg className="desk-icon" width={25} height={25} viewBox="0 0 25 25" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{__html: body}} />
}
