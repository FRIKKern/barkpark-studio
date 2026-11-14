import {useCallback, useEffect, useRef, useState, type RefObject} from 'react'
import {useNavigate} from '@tanstack/react-router'
import {useQueryClient} from '@tanstack/react-query'
import type {ChannelInstance} from '@sanity/comlink'
import type {LoaderControllerMsg, LoaderNodeMsg, VisualEditingControllerMsg, VisualEditingNodeMsg} from '@sanity/presentation-comlink'
import {anyDocQuery, docQuery, schemaOf, schemasQuery} from './data'
import {runPreviewQuery} from './presentation-query'
import {fieldPath, focusPane, focusTarget, forget, framePath, hear, liveResult, loaderListen, mayRead, pageDocuments, readsDocument, refusedMessage, sourceMapOf, type Perspective, type QueryBook, type SourceMap} from './presentation-comlink'

/**
 * Presentation's comlink side, beside the bridge (components/Presentation.tsx): the two
 * channels Sanity's own Presentation opens to a site, with the real @sanity/comlink.
 *
 *   studio "presentation" ◀── visual-editing ──▶ the site's <VisualEditing>: click to edit,
 *        │                                        its URL and title, documents, overlay, focus
 *        └──────────────── ◀── loaders ────────▶ the site's useLiveMode: the studio runs its
 *                                                 queries (lib/presentation-query.ts) and
 *                                                 answers again when a document they read changes
 *
 * Which protocol a frame speaks shows by itself: a bridge site says hello on its own (then
 * this is off); a comlink site answers the handshake this sends once the frame has loaded.
 * The packages load only then: no other tool pays for them. What a message may do is
 * checked in lib/presentation-comlink.ts.
 */

/** A read after an edit: the form saves a document 750 ms after its last key. */
const RERUN_AFTER = 1_200
/** Sanity's: a site with no refresh handler doesn't answer "refreshing"; the frame reloads. */
const REFRESH_WAIT = 300

type PageDoc = {_id: string; _type: string}
type Visual = ChannelInstance<VisualEditingControllerMsg, VisualEditingNodeMsg>
type Loaders = ChannelInstance<LoaderControllerMsg, LoaderNodeMsg>
type Run = {result?: unknown; map?: SourceMap; tags?: string[]; running?: boolean; again?: boolean; timer?: ReturnType<typeof setTimeout>; sentAsRead?: boolean}

export type ComlinkOptions = {
  frame: RefObject<HTMLIFrameElement | null>
  /** The preview site's origin: the only one spoken to, or heard. */
  origin: string
  /** The frame has loaded (a new `generation` is a new frame) and its site doesn't speak the bridge. */
  enabled: boolean
  generation: number
  perspective: Perspective
  /** The Edit switch, as the tool wants the site's overlay. */
  overlays: boolean
  /** The field the document panel has focus in. */
  focus: {id: string; path: string} | null
  onConnected: () => void
  /** The site is at this path (on its own origin). */
  onPage: (path: string) => void
  onDocuments: (docs: PageDoc[]) => void
  /** The site switched its overlay itself (its Alt, its Cmd+\). */
  onOverlays: (enabled: boolean) => void
  /** The site can't refresh itself: load the frame again. */
  onReload: () => void
}

export function usePresentationComlink(o: ComlinkOptions) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [connected, setConnected] = useState(false)
  const [title, setTitle] = useState('')
  const opts = useRef(o)
  opts.current = o
  const live = useRef<{visual: Visual; announce: () => void; refreshing: {timer?: ReturnType<typeof setTimeout>}} | null>(null)

  useEffect(() => {
    const target = o.enabled ? o.frame.current?.contentWindow : null
    if (!target) return
    const origin = o.origin
    let stopped = false
    let teardown = () => {}
    // Before comlink hears anything (capture runs first): only this frame, only its origin.
    const guard = (e: MessageEvent) => refusedMessage(e, target, origin) && e.stopImmediatePropagation()
    window.addEventListener('message', guard, true)

    void Promise.all([import('@sanity/comlink'), import('@sanity/presentation-comlink')]).then(([{createController, createConnectionMachine}, {createCompatibilityActors}]) => {
      if (stopped) return
      const controller = createController({targetOrigin: origin})
      controller.addTarget(target)
      const channel = <S extends VisualEditingControllerMsg | LoaderControllerMsg, R extends VisualEditingNodeMsg | LoaderNodeMsg>(connectTo: string) =>
        controller.createChannel<S, R>({name: 'presentation', heartbeat: true, connectTo}, createConnectionMachine<S, R>().provide({actors: createCompatibilityActors<S>()} as never) as never)
      const visual: Visual = channel('visual-editing')
      const loaders: Loaders = channel('loaders')

      // ── Loaders: the site's queries, run by the studio as this editor ──
      const book: QueryBook<Run> = new Map()
      let site: {projectId: string; dataset: string} | null = null
      const typed = (id: string) => qc.getQueryData(['doc', id])
      const answer = (key: string) => {
        const q = book.get(key)
        if (!q?.state?.map) return
        const result = q.perspective === 'drafts' ? liveResult(q.state.result, q.state.map, typed) : q.state.result
        // Nothing typed over it, and the page already has it as read.
        if (result === q.state.result && q.state.sentAsRead) return
        q.state.sentAsRead = result === q.state.result
        loaders.post('loader/query-change', {projectId: q.projectId, dataset: q.dataset, perspective: q.perspective as Perspective, query: q.query, params: q.params as never, result, resultSourceMap: q.state.map as never, tags: q.state.tags as never})
      }
      const reads: number[] = []
      const run = async (key: string) => {
        const q = book.get(key)
        if (!q) return
        const state = (q.state ??= {})
        if (state.running) return void (state.again = true)
        // The page's reads are the editor's: past a minute's allowance they wait.
        if (!mayRead(reads, Date.now())) return void (clearTimeout(state.timer), (state.timer = setTimeout(() => void run(key), 5_000)))
        state.running = true
        const got = await runPreviewQuery({dataset: q.dataset, perspective: q.perspective, query: q.query, params: q.params}).catch((err: Error) => ({ok: false as const, error: err.message}))
        state.running = false
        if (stopped || book.get(key) !== q) return
        if (got.ok) {
          Object.assign(state, {result: got.result, map: sourceMapOf(got.resultSourceMap), tags: got.tags, sentAsRead: false})
          answer(key)
        } else console.error(`Presentation could not run the preview's query: ${got.error}`)
        if (state.again) (state.again = false), void run(key)
      }
      const tellLoaders = () => site && loaders.post('loader/perspective', {...site, perspective: opts.current.perspective})
      loaders.on('loader/query-listen', (data) => {
        const listen = loaderListen(data)
        if (!listen) return
        site = {projectId: listen.projectId, dataset: listen.dataset}
        // The tool's perspective, never the one the page picks: told, it listens again in ours.
        if (listen.perspective !== opts.current.perspective) return void tellLoaders()
        const {key, fresh} = hear(book, listen, Date.now())
        if (fresh) void run(key)
      })
      const pageDocs = {visual: [] as PageDoc[], loaders: [] as PageDoc[]}
      const types = () => new Set((qc.getQueryData(schemasQuery.queryKey) ?? []).map((s) => s.name))
      const reportDocs = () => opts.current.onDocuments(pageDocuments([...pageDocs.visual, ...pageDocs.loaders], types()))
      loaders.on('loader/documents', (data) => ((pageDocs.loaders = pageDocuments(data?.documents, types())), reportDocs()))
      // A page that loaded again holds none of the answers: every query is new to it.
      loaders.onStatus((e) => e.status === 'connected' && (book.clear(), tellLoaders()))
      const sweep = setInterval(() => forget(book, Date.now(), opts.current.perspective).length, 10_000)
      // J60's way in: the editor's cache changes as they type, before the save.
      const unwatch = qc.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'success') return
        const [kind, id] = event.query.queryKey as [string, string]
        if (kind !== 'doc') return
        for (const [key, q] of book) {
          if (!q.state?.map || !readsDocument(q.state.map, id)) continue
          if (q.perspective === 'drafts') answer(key)
          clearTimeout(q.state.timer)
          q.state.timer = setTimeout(() => void run(key), RERUN_AFTER)
        }
      })

      // ── Visual editing: clicks, the page's URL and title, its documents, its overlay ──
      const overlay = {site: true, asked: false}
      const refreshing: {timer?: ReturnType<typeof setTimeout>} = {}
      let at: string | null = null
      visual.on('visual-editing/focus', (data) => {
        const hit = focusTarget(data)
        if (!hit) return
        void (async () => {
          // Only a type the schema has opens, whatever the page names.
          const schemas = await qc.ensureQueryData(schemasQuery)
          const type = hit.type ?? (await qc.fetchQuery(anyDocQuery(hit.id)).catch(() => null))?._type
          if (stopped || !type || !schemaOf(schemas, type)) return
          const doc = hit.path ? await qc.fetchQuery(docQuery(type, hit.id)).catch(() => undefined) : undefined
          if (stopped) return
          const pane = focusPane({id: hit.id, type, path: hit.path && fieldPath(hit.path, doc)})
          void navigate({to: '/presentation', search: (prev: Record<string, unknown>) => ({...prev, pane})})
        })()
      })
      visual.on('visual-editing/navigate', (data) => {
        const path = framePath(data?.url, origin)
        if (typeof data?.title === 'string') setTitle(data.title.slice(0, 200))
        if (path === null || path === at) return
        at = path
        pageDocs.visual = pageDocs.loaders = []
        opts.current.onPage(path)
      })
      visual.on('visual-editing/meta', (data) => typeof data?.title === 'string' && setTitle(data.title.slice(0, 200)))
      visual.on('visual-editing/documents', (data) => ((pageDocs.visual = pageDocuments(data?.documents, types())), reportDocs()))
      visual.on('visual-editing/toggle', (data) => {
        if (typeof data?.enabled !== 'boolean') return
        const asked = overlay.asked
        Object.assign(overlay, {site: data.enabled, asked: false})
        // Its own switch (not our asking): the Edit switch follows, as Sanity's.
        if (!asked) opts.current.onOverlays(data.enabled)
        else syncOverlay()
      })
      visual.on('visual-editing/refreshing', () => (clearTimeout(refreshing.timer), book.forEach((_, key) => void run(key))))
      visual.on('visual-editing/refreshed', () => opts.current.onConnected())
      // What <VisualEditing> asks of a Studio on connecting. No schema, no optimistic writes:
      // the page reads, the form edits.
      visual.on('visual-editing/fetch-perspective', () => ({perspective: opts.current.perspective}))
      visual.on('visual-editing/features', () => ({features: {optimistic: false}}))
      visual.on('visual-editing/schema', () => ({schema: []}))
      visual.on('visual-editing/shared-state', () => ({state: {}}))
      visual.on('visual-editing/preview-snapshots', () => ({snapshots: []}))
      const syncOverlay = () => {
        const want = opts.current.overlays && opts.current.perspective === 'drafts'
        if (overlay.asked || overlay.site === want) return
        overlay.asked = true
        visual.post('presentation/toggle-overlay')
      }
      const announce = () => {
        visual.post('presentation/perspective', {perspective: opts.current.perspective})
        tellLoaders()
        forget(book, Date.now(), opts.current.perspective)
        syncOverlay()
        const focus = opts.current.focus
        if (focus) visual.post('presentation/focus', focus)
        else visual.post('presentation/blur')
      }
      visual.onStatus((e) => {
        if (stopped) return
        setConnected(e.status === 'connected')
        if (e.status !== 'connected') return
        // A page that loaded again starts with its overlay on.
        Object.assign(overlay, {site: true, asked: false})
        opts.current.onConnected()
        announce()
      })

      live.current = {visual, announce, refreshing}
      const stops = [visual.start(), loaders.start()]
      teardown = () => {
        clearInterval(sweep)
        clearTimeout(refreshing.timer)
        book.forEach((q) => clearTimeout(q.state?.timer))
        unwatch()
        stops.forEach((stop) => stop())
        controller.destroy()
        live.current = null
      }
    })
    return () => {
      stopped = true
      teardown()
      window.removeEventListener('message', guard, true)
      setConnected(false)
      setTitle('')
    }
  }, [o.enabled, o.origin, o.generation, o.frame, qc, navigate])

  // The tool's own controls reach the site: perspective, the Edit switch, the focused field.
  useEffect(() => {
    live.current?.announce()
  }, [o.perspective, o.overlays, o.focus?.id, o.focus?.path])

  /** The URL bar: the site goes there itself. */
  const go = useCallback((path: string) => live.current?.visual.post('presentation/navigate', {type: 'push', url: path}), [])
  /** Refresh: the site's own (every query is then read again); a site with no refresh of its own loads again. */
  const refresh = useCallback(() => {
    const now = live.current
    if (!now) return
    clearTimeout(now.refreshing.timer)
    now.refreshing.timer = setTimeout(() => opts.current.onReload(), REFRESH_WAIT)
    now.visual.post('presentation/refresh', {source: 'manual', livePreviewEnabled: true})
  }, [])
  return {connected, title, go, refresh}
}
