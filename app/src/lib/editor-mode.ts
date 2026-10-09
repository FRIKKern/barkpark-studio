import type {Schema} from './data'

// FF3 (decision 0004): which editor a document type opens in.
//  - main: a PortableDoc type — the Freeform canvas by default, Classic beside it;
//  - alternative: a type with an Expectation (a `layout`) — Classic by default,
//    with a Classic ⇄ Freeform toggle over the same block list;
//  - none: Classic only (the Sanity-parity path).
// (`field`, a richText field's own canvas, is per field: J10/J11.)
// Source: the schema's `layout` (Barkpark's schema read carries it, #22280). A layout
// whose region is one of the type's own richText fields makes a PortableDoc type (the
// document is its block list: main); any other layout is an Expectation over a form
// (alternative). EDITOR_MODES overrides it for a type.
export type EditorMode = 'main' | 'alternative' | 'none'

export const EDITOR_MODES: Record<string, EditorMode> = {
  paper: 'main', // Bulldocs' PortableDoc type, with or without a layout in this workspace
}

export function editorMode(type: string, schema?: Schema): EditorMode {
  if (EDITOR_MODES[type]) return EDITOR_MODES[type]
  const layout = schema?.layout ?? []
  if (!layout.length) return 'none'
  const regions = new Set(layout.filter((l) => l.kind === 'region').map((l) => l.name))
  return schema!.fields.some((f) => f.type === 'richText' && regions.has(f.name)) ? 'main' : 'alternative'
}

/** A document view: the form, the canvas, the doc as JSON, or one of the schema's desk views (B09). */
export type View = 'classic' | 'freeform' | 'json' | `desk:${string}`
/** The view a type opens in when the URL names none. */
export const defaultView = (mode: EditorMode): View => (mode === 'main' ? 'freeform' : 'classic')
/** The URL's `view` param for a view: none for the type's default. */
export const viewParam = (view: View, mode: EditorMode) => (view === defaultView(mode) ? '' : view)
/** The view a URL `view` param means for this type ('' and unknown → the default). */
export const viewOf = (param: string | undefined, mode: EditorMode): View =>
  param === 'json' || param === 'freeform' || param === 'classic' || param?.startsWith('desk:') ? (param as View) : defaultView(mode)
