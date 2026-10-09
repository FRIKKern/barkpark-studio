import {useCallback, useEffect, useReducer, useRef, useState} from 'react'
import {useNavigate} from '@tanstack/react-router'
import {useQueryClient} from '@tanstack/react-query'
import {useT} from '../lib/i18n'
import {docQuery, listQuery} from '../lib/data'
import type {Pane} from '../lib/panes'
import type {MainDocument} from '../lib/plugins'
import {Desktop, LaunchIcon, Mobile, Share, SyncIcon, WarningOutline} from './icons'
import {DialogBox} from './FocusScopes'
import {PaneHrefContext} from './PaneLink'
import {RefPreview} from './Preview'
import {Structure} from './Structure'

/**
 * J58, Sanity's Presentation tool: the site in an iframe beside the document
 * panel, with Sanity's connection states (its presentation machine, sanity 6.17):
 *
 *   iframe loading ── 15 s, no load event ──▶ "Could not connect to the preview"
 *   (Loading.)                                [Retry] [Continue anyway]
 *        │ load
 *        ▼
 *   no hello yet ── 5 s ──▶ "Connecting." ── 3 s ──▶ "Unable to connect, …"
 *   (Loading.)                                        [Continue anyway]
 *        │ hello
 *        ▼
 *   connected: the overlays go, the page is usable
 *
 * The site talks to us with a few postMessage events (reference/preview-site/src/
 * barkpark.ts) where Sanity's uses comlink. "Continue anyway" on a failed connection
 * holds until the site connects, across reloads, as Sanity's does.
 */

export const LOAD_TIMEOUT = 15_000
export const SLOW_AFTER = 5_000
export const TIMEOUT_AFTER = 3_000

type State = {
  load: 'loading' | 'timedOut' | 'dismissed' | 'loaded'
  /** The site said hello since the iframe last (re)loaded, or since a refresh it asked for. */
  connected: boolean
  /** It has connected before on this page: a refresh reconnects without the overlays. */
  hadConnection: boolean
  wait: 'pending' | 'slow' | 'timedOut'
  /** "Continue anyway" after a failed connection, until one succeeds. */
  dismissed: boolean
  refreshing: boolean
}

type Action =
  | {type: 'reload'}
  | {type: 'refresh'}
  | {type: 'load timeout'}
  | {type: 'continue'}
  | {type: 'loaded'}
  | {type: 'hello'}
  | {type: 'slow'}
  | {type: 'wait timeout'}

const initial: State = {load: 'loading', connected: false, hadConnection: false, wait: 'pending', dismissed: false, refreshing: false}

function reduce(s: State, a: Action): State {
  switch (a.type) {
    case 'reload':
      return {...s, load: 'loading', connected: false, hadConnection: false, wait: 'pending', refreshing: false}
    case 'refresh':
      return {...s, connected: false, refreshing: true}
    case 'load timeout':
      return s.load === 'loading' ? {...s, load: 'timedOut'} : s
    case 'continue':
      return s.load === 'timedOut' ? {...s, load: 'dismissed'} : {...s, dismissed: true}
    case 'loaded':
      return {...s, load: 'loaded', wait: 'pending'}
    case 'hello':
      return {...s, connected: true, hadConnection: true, dismissed: false, refreshing: false}
    case 'slow':
      return s.wait === 'pending' ? {...s, wait: 'slow'} : s
    case 'wait timeout':
      return s.wait === 'slow' ? {...s, wait: 'timedOut'} : s
  }
}

type PageDoc = {_id: string; _type: string}

/** J61: the page's main document, from the config's routes (`/posts/:slug` → the post whose slug is that). */
export function matchRoute(routes: MainDocument[], path: string): {route: MainDocument; value: string} | undefined {
  for (const route of routes) {
    const re = new RegExp(`^${route.route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/, '([^/]+)')}/?$`)
    const m = re.exec(path)
    if (m) return {route, value: decodeURIComponent(m[1] ?? '')}
  }
}

/**
 * The page's state lives in the URL, like Sanity's: `?preview=` is the site's path and
 * `?pane=` the document panel's pane chain (a structure path), so the panel is the
 * same panes as /structure, hosted here (PaneHrefContext maps their hrefs).
 */
export function Presentation({previewUrl, preview = '/', panes, mainDocuments = [], viewport, perspective}: {previewUrl: string; preview?: string; panes: Pane[] | null; mainDocuments?: MainDocument[]; viewport?: 'mobile'; perspective?: string}) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const origin = new URL(previewUrl).origin
  const frame = useRef<HTMLIFrameElement>(null)
  const [src, setSrc] = useState(() => new URL(preview, previewUrl).toString())
  const [url, setUrl] = useState(src)
  const [typed, setTyped] = useState<string | null>(null)
  const [docs, setDocs] = useState<PageDoc[]>([])
  const [missing, setMissing] = useState<string | null>(null)
  const previewRef = useRef(preview)
  previewRef.current = preview
  // A page opened together with a document (a location link, a URL naming both)
  // keeps that document in the panel, as Sanity's does; moving on in the site
  // brings the main document back.
  const keepPane = useRef<string | null>(panes?.some((p) => p.kind === 'doc') ? preview : null)
  const [s, send] = useReducer(reduce, initial)
  // The frame mounts after hydration: one rendered on the server can fire its load
  // event before React listens, and the overlay would wait forever.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // Overlays only while the page has never connected since it loaded.
  const connecting = s.load === 'loaded' && !s.connected && !s.hadConnection && !s.dismissed

  useEffect(() => {
    if (s.load !== 'loading') return
    const timer = setTimeout(() => send({type: 'load timeout'}), LOAD_TIMEOUT)
    return () => clearTimeout(timer)
  }, [s.load, src])
  useEffect(() => {
    if (!connecting) return
    const timer = s.wait === 'pending' ? setTimeout(() => send({type: 'slow'}), SLOW_AFTER) : s.wait === 'slow' ? setTimeout(() => send({type: 'wait timeout'}), TIMEOUT_AFTER) : undefined
    return () => clearTimeout(timer)
  }, [connecting, s.wait])

  // The overlay says "check the browser console": this is what it finds there.
  useEffect(() => {
    if (s.load === 'timedOut') console.error(`The preview iframe hasn't finished loading after ${LOAD_TIMEOUT}ms (${src}).`)
  }, [s.load])
  useEffect(() => {
    if (connecting && s.wait === 'timedOut')
      console.error(`Unable to connect to the preview at ${origin}. The site has to post {bp: 'preview', type: 'hello'} to its parent (see reference/preview-site/src/barkpark.ts).`)
  }, [connecting, s.wait])
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow || e.data?.bp !== 'preview') return
      if (e.data.type === 'hello') send({type: 'hello'})
      if (e.data.type === 'location' && typeof e.data.url === 'string') onPage(e.data.url)
      if (e.data.type === 'documents' && Array.isArray(e.data.documents)) setDocs(e.data.documents.filter((d: PageDoc) => typeof d?._id === 'string' && typeof d?._type === 'string'))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin])

  // J61: the site moved (a link, the URL bar, back): the URL follows it, and the panel
  // shows the page's main document; a route whose document is missing shows the
  // documents on the page and says so.
  const onPage = async (path: string) => {
    setUrl(new URL(path, origin).toString())
    setTyped(null)
    setDocs([])
    if (keepPane.current === path) {
      keepPane.current = null
      setMissing(null)
      return void navigate({to: '/presentation', search: (prev: Record<string, unknown>) => ({...prev, preview: path}), replace: true})
    }
    keepPane.current = null
    const hit = matchRoute(mainDocuments, path.split('?')[0]!)
    let pane: string | undefined
    if (hit) {
      const id = hit.route.field
        ? (await qc.fetchQuery(listQuery(hit.route.type, 'updated', 1, {[hit.route.field]: {eq: hit.value}})).catch(() => undefined))?.docs[0]?._publishedId
        : (await qc.fetchQuery(docQuery(hit.route.type, hit.value)).catch(() => undefined))?._publishedId
      if (id) pane = `${hit.route.type};${id}`
    }
    setMissing(hit && !pane ? path : null)
    // As Sanity's: a page no route claims keeps the panel as it is.
    void navigate({to: '/presentation', search: (prev: Record<string, unknown>) => ({...prev, preview: path, ...(hit ? {pane} : {})}), replace: true})
  }

  // The URL bar: a path or a URL on the site's origin; the site navigates itself when
  // connected, else the frame loads it.
  const go = (value: string) => {
    let target: URL
    try {
      target = new URL(value, origin)
    } catch {
      return
    }
    if (target.origin !== origin) return setTyped(null)
    const path = target.pathname + target.search
    if (s.connected) frame.current?.contentWindow?.postMessage({bp: 'studio', type: 'navigate', url: path}, origin)
    else {
      setUrl(target.toString())
      send({type: 'reload'})
      setSrc(target.toString())
      setGeneration((g) => g + 1)
    }
    setTyped(null)
  }

  // J63: the site shows the perspective the document panel shows (its Published /
  // Draft chips set ?perspective=), told again on every hello.
  const shownPerspective = perspective === 'published' ? 'published' : 'drafts'
  const tell = useCallback((msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({bp: 'studio', ...msg}, origin), [origin])
  useEffect(() => {
    if (s.connected) tell({type: 'perspective', perspective: shownPerspective})
  }, [s.connected, shownPerspective, tell])

  // J60: an edit to a document on the page reaches the site as it is typed (the
  // editor's cache changes before the save), not after the save comes back round.
  const pageIds = useRef(new Set<string>())
  pageIds.current = new Set(docs.map((d) => d._id))
  useEffect(() => {
    if (!s.connected || shownPerspective !== 'drafts') return
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return
      const [kind, id] = event.query.queryKey as [string, string]
      const doc = event.query.state.data as {_id?: string} | null | undefined
      if (kind === 'doc' && pageIds.current.has(id) && doc?._id) tell({type: 'doc', doc})
    })
  }, [s.connected, shownPerspective, qc, tell])

  // J62: a location link (or Back) changes ?preview=: the site goes there.
  useEffect(() => {
    if (preview === new URL(url).pathname + new URL(url).search) return
    if (panes?.some((p) => p.kind === 'doc')) keepPane.current = preview
    go(preview)
  }, [preview])

  // Pane hrefs (`/structure/…`) stay in Presentation: the chain goes in `?pane=`.
  const paneHref = useCallback((href: string) => {
    if (!href.startsWith('/structure')) return href
    const u = new URL(href, 'http://x')
    const splat = decodeURIComponent(u.pathname.replace(/^\/structure\/?/, ''))
    const q = new URLSearchParams(u.search)
    q.set('preview', previewRef.current)
    if (splat) q.set('pane', splat)
    return `/presentation?${q}`
  }, [])
  const docPane = panes && panes[panes.length - 1]?.kind === 'doc'

  // A new frame each reload: assigning the same src to one still loading is ignored.
  const [generation, setGeneration] = useState(0)
  const reload = () => {
    send({type: 'reload'})
    setSrc(url)
    setGeneration((g) => g + 1)
  }
  // Sanity's refresh: a connected site reloads itself and says hello again; otherwise
  // the frame reloads.
  const refresh = () => {
    if (!s.connected) return reload()
    send({type: 'refresh'})
    frame.current?.contentWindow?.postMessage({bp: 'studio', type: 'refresh'}, origin)
  }

  const busy = s.load === 'loading' || s.refreshing || connecting
  const status = s.load === 'loading' ? t('Loading.') : s.refreshing ? t('Refreshing.') : undefined
  const blocked = s.load === 'loading' || s.load === 'timedOut' || connecting
  return (
    <div className="presentation">
      <section className="presentation-preview" aria-label={t('Presentation')}>
        <div className="presentation-toolbar">
          <button type="button" className="icon-btn" aria-label={t('Refresh preview')} data-tip={status ?? t('Refresh preview')} aria-busy={s.refreshing || s.load === 'loading'} onClick={refresh}>
            <SyncIcon />
          </button>
          <input
            className="input presentation-url"
            aria-label="URL"
            value={typed ?? url}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(e.currentTarget.value)
              if (e.key === 'Escape') setTyped(null)
            }}
            onBlur={() => setTyped(null)}
          />
          <a className="icon-btn" href={url} target="_blank" rel="noopener" aria-label={t('Open preview')} data-tip={t('Open preview')}>
            <LaunchIcon />
          </a>
          {/* J64: Sanity's viewport toggle, kept in the URL (?viewport=mobile). */}
          <button
            type="button"
            className="icon-btn"
            aria-label={t('Toggle viewport size')}
            data-tip={viewport === 'mobile' ? t('Switch to full viewport') : t('Switch to narrow viewport')}
            aria-pressed={viewport === 'mobile'}
            onClick={() => void navigate({to: '/presentation', search: (prev: Record<string, unknown>) => ({...prev, viewport: viewport === 'mobile' ? undefined : ('mobile' as const)}), replace: true})}
          >
            {viewport === 'mobile' ? <Desktop /> : <Mobile />}
          </button>
          <ShareMenu />
        </div>
        <div className="presentation-frame" data-viewport={viewport ?? 'desktop'} style={{cursor: busy ? 'wait' : undefined}}>
          {mounted && <iframe key={generation} ref={frame} src={src} title={t('Presentation')} style={{pointerEvents: blocked ? 'none' : undefined}} onLoad={() => send({type: 'loaded'})} />}
          {s.load === 'loading' ? (
            <Status text={t('Loading.')} />
          ) : s.load === 'timedOut' ? (
            <div className="presentation-overlay error" role="alert">
              <div className="presentation-error">
                <h2>{t('An error occurred')}</h2>
                <p>{t('Could not connect to the preview')}</p>
                <div>
                  <button type="button" className="btn" onClick={reload}>
                    {t('Retry')}
                  </button>
                  <button type="button" className="btn continue" onClick={() => send({type: 'continue'})}>
                    {t('Continue anyway')}
                  </button>
                </div>
              </div>
            </div>
          ) : connecting && s.wait === 'pending' ? (
            <Status text={t('Loading.')} />
          ) : connecting ? (
            <div className="presentation-overlay connecting" data-timed-out={s.wait === 'timedOut' || undefined}>
              <div className="presentation-status" role="status" data-tone={s.wait === 'timedOut' ? 'caution' : undefined}>
                <span className="spinner" aria-hidden="true" />
                {s.wait === 'timedOut' ? t('Unable to connect, check the browser console for more information.') : t('Connecting.')}
              </div>
              {s.wait === 'timedOut' && (
                <button type="button" className="btn danger" onClick={() => send({type: 'continue'})}>
                  {t('Continue anyway')}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </section>
      <PaneHrefContext.Provider value={paneHref}>
        {docPane ? (
          <aside className="presentation-panel docked" aria-label={t('Document')}>
            <Structure panes={panes} widthHint={350} />
          </aside>
        ) : (
          <aside className="presentation-panel" aria-label={t('Documents on this page')}>
            {missing && (
              <p className="presentation-missing" role="status">
                <WarningOutline /> <span>{t('Missing a main document for')} <code>{missing}</code></span>
              </p>
            )}
            <h2>{t('Documents on this page')}</h2>
            {docs.length ? (
              <div className="presentation-docs">
                {docs.map((d) => (
                  <RefPreview key={d._id} type={d._type} id={d._id} href={`/structure/${d._type};${d._id}`} selected={false} />
                ))}
              </div>
            ) : (
              <p className="presentation-empty">{t('No matching documents')}</p>
            )}
          </aside>
        )}
      </PaneHrefContext.Provider>
    </div>
  )
}

/**
 * J64, Sanity's share menu: sharing on/off, a QR code of the shared link, Copy
 * preview link. Sharing mints a secret preview link on the server, which Barkpark
 * cannot do yet (task-6812c3100d7aedbc): the switch stays off and says why.
 */
function ShareMenu() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    // Nothing inside can take focus while sharing is unavailable, so Escape is caught here too.
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()} onKeyDown={(e) => open && e.key === 'Escape' && (e.stopPropagation(), close())}>
      <button type="button" className="icon-btn" aria-label={t('Share this preview')} data-tip={t('Share this preview')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Share />
      </button>
      {open && (
        <DialogBox className="popover share-preview" aria-label={t('Share this preview')} onClose={close}>
          <label className="share-toggle" title={t('Barkpark cannot share previews yet')}>
            <span className="switch">
              <input type="checkbox" role="switch" checked={false} disabled readOnly />
              <span />
            </span>
            <span>
              {t('Share this preview')}
              <small>{t('with anyone who has the link')}</small>
            </span>
          </label>
          <div className="share-qr" aria-hidden="true">
            {t('QR code will appear here')}
          </div>
          <p className="share-note">{t('Scan the QR Code to open the preview on your phone.')}</p>
          <hr />
          <button type="button" className="menu-item" disabled>
            {t('Copy preview link')}
          </button>
        </DialogBox>
      )}
    </div>
  )
}

function Status({text}: {text: string}) {
  return (
    <div className="presentation-overlay">
      <div className="presentation-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        {text}
      </div>
    </div>
  )
}
