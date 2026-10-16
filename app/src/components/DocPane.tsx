import {Fragment, Suspense, use, useContext, useEffect, useRef, type ComponentProps} from 'react'
import {useT} from '../lib/i18n'
import {holdMarkUntil} from '../lib/hydrated'
import {OpenedPanesContext} from '../lib/layout'
import {paneKey} from '../lib/panes'
import {untilLoaded} from './DocEditors'

// Cold load (task-a8874d0ebb2baa5c): the document pane (its form, fields, history, comments)
// is a chunk of its own. The desk and a list never draw it, so they no longer download or
// parse it; a document page fetches it with the page (modulepreload) and hydrates once it is
// here (client.tsx), and the desk fetches it when idle. Its own chunk, not the editors': with
// the editors offline, the rest of the form still types on (J20).
type Mod = typeof import('./doc-pane')
let pending: (Promise<Mod> & {status?: string; value?: Mod}) | undefined
export const loadDocPane = () => (pending ??= untilLoaded(() => import('./doc-pane')).then((m) => (Object.assign(pending!, {status: 'fulfilled', value: m}), m)))
if (import.meta.env.SSR) void loadDocPane()

// A page with a document pane is interactive (html[data-hydrated]) once its pane is: marked
// when the route mounted, the form could still be the server's inert HTML, and a test typed
// into it. Held when a pane draws before the mark, not by the URL: Presentation with no
// document open has none, and its mark waited the hold out (J59 on #774's CI).
let live = () => {}
let held = false
const holdForPane = () => {
  if (held || typeof window === 'undefined' || document.documentElement.hasAttribute('data-hydrated')) return
  held = true
  holdMarkUntil(new Promise<void>((r) => (live = r)))
}
function Live() {
  useEffect(() => live(), [])
  return null
}

function Pane(props: ComponentProps<Mod['DocumentPane']>) {
  const {DocumentPane: P} = use(loadDocPane())
  return (
    <Fragment>
      <P {...props} />
      <Live />
    </Fragment>
  )
}

/** Opened before the chunk lands (a click on the desk before its idle fetch): the pane's title and "Loading document…", never a blank pane. */
export function DocumentPane(props: ComponentProps<Mod['DocumentPane']>) {
  holdForPane()
  // Opening a document moves focus into its form (#779) when the pane came with this URL,
  // which Structure knows only until its commit's effects. The pane mounts when its chunk
  // lands, later: what was true at this first render is handed on (J01 J02's reload on #774).
  const openedPanes = useContext(OpenedPanesContext)
  const key = paneKey(props.panes[props.index]!) + props.index
  const opened = useRef<{current: Set<string>} | null>(null)
  opened.current ??= {current: new Set(!openedPanes || openedPanes.current.has(key) ? [key] : [])}
  const t = useT()
  const loading = (
    <section className="pane doc" data-pane-index={props.index} aria-label={t('Document')} aria-busy="true">
      <div className="doc-title-bar">{props.header}</div>
      <div className="pane-body">
        <div className="pane-loading">{t('Loading document…')}</div>
      </div>
    </section>
  )
  return (
    <OpenedPanesContext.Provider value={opened.current}>
      <Suspense fallback={loading}>
        <Pane {...props} />
      </Suspense>
    </OpenedPanesContext.Provider>
  )
}

/** Fetch the chunk when the browser is idle (the desk calls this once it has rendered). */
export function usePrefetchDocPane() {
  useEffect(() => {
    if (pending) return
    const idle = (globalThis as {requestIdleCallback?: (f: () => void) => number}).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200))
    idle(() => void loadDocPane())
  }, [])
}
