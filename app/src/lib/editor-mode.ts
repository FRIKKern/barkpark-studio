import type {Schema} from './data'

// FF3 (decision 0004): which editor a document type opens in.
//  - main: a PortableDoc type — the Freeform canvas by default, Classic beside it;
//  - alternative: a type with an Expectation (a `layout`) — Classic by default,
//    with a Classic ⇄ Freeform toggle over the same block list;
//  - none: Classic only (the Sanity-parity path).
// (`field`, a richText field's own canvas, is per field: J10/J11.)
// Source: the schema's `layout` once Barkpark's schema read carries it
// (task-28082a4cf187403d); until then this map, which wins over it.
export type EditorMode = 'main' | 'alternative' | 'none'

export const EDITOR_MODES: Record<string, EditorMode> = {
  paper: 'main', // Bulldocs' PortableDoc type
  story: 'alternative', // the Expectation fixture (fixtures/barkpark-schema/story.json)
}

export function editorMode(type: string, schema?: Schema & {layout?: unknown}): EditorMode {
  return EDITOR_MODES[type] ?? (schema?.layout ? 'alternative' : 'none')
}

/** A document view: the form, the canvas, or the doc as JSON. */
export type View = 'classic' | 'freeform' | 'json'
/** The view a type opens in when the URL names none. */
export const defaultView = (mode: EditorMode): View => (mode === 'main' ? 'freeform' : 'classic')
/** The URL's `view` param for a view: none for the type's default. */
export const viewParam = (view: View, mode: EditorMode) => (view === defaultView(mode) ? '' : view)
/** The view a URL `view` param means for this type ('' and unknown → the default). */
export const viewOf = (param: string | undefined, mode: EditorMode): View =>
  param === 'json' || param === 'freeform' || param === 'classic' ? param : defaultView(mode)
