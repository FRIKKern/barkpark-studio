// B12: the icons a desk row names, as Sanity draws them (@sanity/icons, MIT, see THIRD-PARTY.md).
// Keyed by Sanity's icon names; an unknown name shows no icon.
// task-af038d8b0d769e82: every @sanity/icons 5.2.3 name (MIT), plus lucide's `library`
// (ISC), the same vocabulary Barkpark's LiveView Studio draws (barkpark priv/desk_icons.json,
// vendored as lib/desk-icons.json). Before, 12 names drew and the rest showed nothing.
// The desk's own icons come with the desk, each one's body as `iconSvg` (lib/desk-icon-bodies.ts):
// the whole table (96 KB) was in every page's first chunk. Folder and document, the two the
// studio names itself, are here; any other name (a config's) loads the table, once.
import {useEffect, useState} from 'react'

const FOLDER = '<path d="M11.5 8.5H19.5V18.5H5.5V5.5H10.5L11.5 8.5ZM11.5 8.5H5.5" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path>'
const DOCUMENT = '<path d="M11.5 4.5V9.5H6.5" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path><path d="M18.5 20.5H6.5V9.5L11.5 4.5H18.5V20.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path>'
const OWN: Record<string, string> = {folder: FOLDER, document: DOCUMENT}
let table: Record<string, string> | undefined
let loading: Promise<void> | undefined
const loadTable = () => (loading ??= import('../lib/desk-icons.json').then((m) => void (table = m.default as Record<string, string>)))
// `svg` from the server: the body, or '' for a name the table lacks (nothing to load for it).
const own = (t: Record<string, string> | undefined, name: string) => (t && Object.hasOwn(t, name) ? t[name] : undefined)
const bodyOf = (name?: string, svg?: string) => (svg !== undefined ? svg || undefined : name ? (own(OWN, name) ?? own(table, name)) : undefined)

/** An icon's SVG body (25×25 viewBox): the desk's `iconSvg`, else by name; Sanity's DocumentIcon when it has none. */
export const iconBody = (name?: string, svg?: string) => bodyOf(name, svg) || DOCUMENT

/** A desk icon by name (with its body when the desk sent one), or null. The SVG bodies are fixed strings from @sanity/icons, never user input. */
export function DeskIcon({name, svg}: {name?: string; svg?: string}) {
  const [, loaded] = useState(false)
  const body = bodyOf(name, svg)
  useEffect(() => {
    if (name && svg === undefined && !body && !table) void loadTable().then(() => loaded(true))
  }, [name, body])
  if (!body) return null
  // data-sanity-icon names it as Sanity's icons do.
  return <svg className="desk-icon" data-sanity-icon={name} width={25} height={25} viewBox="0 0 25 25" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{__html: body}} />
}
