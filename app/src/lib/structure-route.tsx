import {QueryClient, useQuery} from '@tanstack/react-query'
import {setPresenceSelf, usePresenceStream} from './presence'
import {Navbar} from '../components/Navbar'
import {Structure} from '../components/Structure'
import {anyDocQuery, cachedDoc, deskQuery, docQuery, ensureAnyDocs, ensureDocs, refId, fetchResumeMark, fetchViewportHint, listQuery, publishedQuery, refTypesOf, schemaOf, schemasQuery, type Doc, type Field, type Schema} from './data'
import {deskIndex, deskSort, listFilter, parseDeskPanes, rootDesk, unsupportedOps} from './desk'
import {parseSingletonPanes, type Pane} from './panes'
import {startsAtStudioItem, studioDesk} from './structure-config'
import {loadRefs, mediaRefs, previewRefs, textRefs} from './preview'
import {meQuery, provisionalMe} from './session'
import {withinBudget} from './ssr-budget'
import {DEFAULT_SORT, fetchListPrefs, ListPrefsContext, readListPrefsCookie, writeListPrefs, type ListPrefs} from './list-prefs'
import {useEffect, useState} from 'react'
import {useLivePausedToast, useReconnectingToast} from './connection'
import {resumeLive} from './live'
import {redirect, useRouter} from '@tanstack/react-router'

// Everything a pane chain needs before it paints: schemas, the list, every open
// doc, and the docs their previews follow (refs + preview subtitles). On a
// reload this runs on the server, so the whole chain arrives in the HTML.
// Referenced docs are fetched per type in one request (one shared token, one
// rate bucket: see server/barkpark.ts).
// In the browser, a pane opens as soon as its own doc is there; references load
// behind it (their previews fill in), so opening never waits on the network for
// data the pane can paint without.
/** With sign-in on, the structure needs an editor: send others to /login. */
export async function requireEditor(queryClient: QueryClient, href: string) {
  // On the server, Barkpark gets 600 ms to say who this is; late, the session cookie says
  // (provisionalMe: signed in as they are, nothing allowed until the browser asks again).
  // The sign-in check below runs either way.
  const me = typeof window === 'undefined' ? await withinBudget(queryClient, meQuery, 600, () => provisionalMe()) : await queryClient.ensureQueryData(meQuery)
  if (me.signIn !== 'shared' && !me.email) throw redirect({to: '/login', search: {redirect: href}})
}

/** How long a server render waits on Barkpark before it sends the shell instead (task-9379f9fa115b156f). */
const SSR_BUDGET_MS = 1500

/** What a pane chain renders: its panes, or (`deferred`) the shell a slow Barkpark leaves, the browser filling it in. */
export type PanesData = {panes: Pane[]; widthHint: number; listPrefs: ListPrefs; resume?: number | null; deferred?: true}

/**
 * The route's loader. On the server a slow Barkpark (9–10 s schema and desk reads were seen)
 * held the whole page: no byte until every read in the chain had landed (82 s with 20 s
 * reads), a blank tab. Now the server waits at most SSR_BUDGET_MS: past it, the shell goes
 * out (navbar, the root pane loading) while the reads it started carry on and stream their
 * answers into the page as they land (the SSR query integration), and the browser runs
 * the chain itself. A normal Barkpark answers well inside the budget: the page is as before.
 */
export async function loadPanes(queryClient: QueryClient, splat: string | undefined, published = false): Promise<PanesData> {
  if (typeof window !== 'undefined') return loadPaneChain(queryClient, splat, published)
  // On a scratch client, so a chain past the budget never holds the page: the request's
  // client streams every query it holds, and the page waited for each to land.
  const scratch = new QueryClient({defaultOptions: {queries: {retry: false}}})
  const chain = loadPaneChain(scratch, splat, published)
  const inTime = await Promise.race([chain, new Promise<null>((r) => setTimeout(r, SSR_BUDGET_MS, null))])
  if (!inTime) {
    chain.catch(() => {})
    return {panes: [{kind: 'types'}], widthHint: await fetchViewportHint(), listPrefs: {}, deferred: true}
  }
  // In time: what it read is the page's, as before.
  for (const q of scratch.getQueryCache().getAll()) if (q.state.status === 'success') queryClient.setQueryData(q.queryKey, q.state.data)
  return inTime
}

async function loadPaneChain(queryClient: QueryClient, splat: string | undefined, published = false): Promise<PanesData> {
  const onServer = typeof window === 'undefined'
  // Before any read: frames after this point reach the page once its stream opens.
  const resume = onServer ? await fetchResumeMark() : undefined
  // The list prefs and the width hint need nothing below: asked for now, they ride the
  // desk + schemas round trip instead of adding one of their own (fetchListPrefs never throws).
  const hints = Promise.all([
    onServer ? fetchViewportHint() : document.querySelector('[data-testid=panes]')?.clientWidth ?? window.innerWidth,
    onServer ? (fetchListPrefs() as Promise<ListPrefs>) : readListPrefsCookie(),
  ])
  // B12: a declared desk decides what the URL's segments name.
  // B13: without a desk, a singleton type's segment is its one doc, so schemas come first too.
  const [desk, schemas] = await Promise.all([queryClient.ensureQueryData(deskQuery), queryClient.ensureQueryData(schemasQuery)])
  // J18: without one, the studio's own structure items still name their segments.
  const own = desk ? null : studioDesk()
  const parsed = desk ? parseDeskPanes(splat, desk) : own && startsAtStudioItem(splat) ? parseDeskPanes(splat, own) : parseSingletonPanes(splat, new Set(schemas.filter((s) => s.singleton).map((s) => s.name)))
  const panes = await Promise.all(parsed.map((p) => (p.kind === 'doc' && p.untyped ? typeOf(queryClient, p) : p)))
  const root = rootDesk(desk, own)
  const nodes = root ? deskIndex(root) : undefined
  const [widthHint, listPrefs] = await hints
  // The list and the open docs don't depend on each other: one round trip, not two.
  // J50: a read that fails is that pane's to show (error card, Retry), not the route's.
  // J51: in the browser a click never waits on the network: what is cached paints at
  // once, anything else paints its pane now and fills in (like Sanity's panes).
  const settle = <T,>(p: Promise<T>) => p.catch(() => undefined)
  const data = Promise.all([
    Promise.all(
      panes.flatMap((p) => {
        if (p.kind !== 'list' || !schemaOf(schemas, p.type)) return []
        const node = p.node ? nodes?.get(p.node) : undefined
        const filter = listFilter(node, p.treeParent)
        if (unsupportedOps(filter).length) return []
        return [settle(queryClient.ensureQueryData(listQuery(p.type, listPrefs[p.type]?.sort ?? deskSort(node) ?? DEFAULT_SORT, undefined, filter)).then((l) => l.docs))]
      }),
    ),
    // A tree level shows its parent category on top (B12): that doc too.
    Promise.all(panes.flatMap((p) => (!('type' in p) || !schemaOf(schemas, p.type) ? [] : p.kind === 'doc' ? [settle(queryClient.ensureQueryData(docQuery(p.type, p.id)))] : p.kind === 'list' && p.treeParent && !(p.node && nodes?.get(p.node)?.child) ? [settle(queryClient.ensureQueryData(docQuery(p.type, p.treeParent)))] : []))),
    // The Published perspective shows an open doc's published version: read it here too, or
    // the server draws the pane without it while the browser, its read streamed in, draws it
    // (a hydration mismatch: a singleton under ?perspective=published, B13).
    Promise.all(published ? panes.flatMap((p) => (p.kind === 'doc' && schemaOf(schemas, p.type) ? [settle(queryClient.ensureQueryData(publishedQuery(p.type, p.id)))] : [])) : []),
  ])
  if (!onServer && !(await Promise.race([data.then(() => true), new Promise<false>((r) => setTimeout(r, 0, false))]))) {
    void data.then(([listed, open]) => followRefs(queryClient, schemas, listed, open))
    return {panes, widthHint, listPrefs, resume}
  }
  const [listed, open] = await data
  const refs = followRefs(queryClient, schemas, listed, open)
  if (onServer) await refs
  return {panes, widthHint, listPrefs, resume}
}

/**
 * A followed doc with no `type=` (`post;post-01;author-alan`) takes the list's type
 * until read; as in Sanity, its real type is looked up when it is not that. A cached
 * doc (a reference the pane before it showed) answers without a request.
 */
async function typeOf(qc: QueryClient, p: Extract<Pane, {kind: 'doc'}>): Promise<Pane> {
  const {untyped: _, ...pane} = p
  const known = qc.getQueryData<Doc | null>(['doc', p.id]) ?? (await qc.ensureQueryData(docQuery(p.type, p.id)).catch(() => undefined))
  if (known !== null) return known && known._type !== p.type ? {...pane, type: known._type} : pane
  const doc = await qc.fetchQuery(anyDocQuery(p.id)).catch(() => null)
  if (!doc || doc._type === p.type) return pane
  // The miss under the list's type is cached under the same key: read it again as its own type.
  qc.removeQueries({queryKey: ['doc', p.id], exact: true})
  return {...pane, type: doc._type}
}

/** The docs open docs reference, and what every visible preview needs; a preview that fails shows its own state. */
async function followRefs(queryClient: QueryClient, schemas: Schema[], listed: (Doc[] | undefined)[], open: (Doc | null | undefined)[]) {
  const openDocs = open.filter((d): d is Doc => !!d)
  const rows = listed.flat().filter((d): d is Doc => !!d)
  // Level 1: what open docs reference, and what every visible preview needs.
  const l1 = await ensureRefs(queryClient, schemas, [...openDocs.map((d) => [d, true] as const), ...rows.map((d) => [d, false] as const)]).catch(() => [] as Doc[])
  await Promise.all([
    // Level 2: the subtitles of those references' own previews.
    ensureRefs(queryClient, schemas, l1.map((d) => [d, false] as const)).catch(() => {}),
    // The rest of what the list rows' preview paths cross, past the first reference.
    ensurePreviewRefs(queryClient, schemas, rows).catch(() => {}),
  ])
}

/**
 * The docs list rows' preview paths read through (`heroImage.asset.url`, `parent.parent.title`):
 * one batch per reference depth for all rows, as a row reads them (lib/preview.ts loadRefs).
 */
async function ensurePreviewRefs(qc: QueryClient, schemas: Schema[], docs: Doc[]) {
  const deref = cachedDoc(qc)
  const refs = () =>
    docs.flatMap((d) => {
      const lp = schemaOf(schemas, d._type)?.listPreview
      return [...mediaRefs(lp?.media, d, deref), ...textRefs(lp?.subtitle, d, deref)]
    })
  await loadRefs(refs, (id) => deref(id) !== undefined, async (ids) => {
    for (let i = 0; i < ids.length; i += 100) await ensureAnyDocs(qc, ids.slice(i, i + 100))
  })
}

/** For each [doc, allRefs]: the preview-subtitle ref, and (allRefs) every reference field. */
async function ensureRefs(qc: QueryClient, schemas: Schema[], docs: (readonly [Doc, boolean])[]): Promise<Doc[]> {
  // Keyed by the field's target types ("post,author"): an id is looked up in all of them.
  const byType = new Map<string, Set<string>>()
  const want = (field: Field | undefined, id: unknown) => {
    const types = refTypesOf(field).join(',')
    if (!types || typeof id !== 'string' || !id) return
    if (!byType.has(types)) byType.set(types, new Set())
    byType.get(types)!.add(id)
  }
  for (const [doc, allRefs] of docs) {
    const schema = schemaOf(schemas, doc._type)
    if (!schema) continue
    for (const name of previewRefs(schema.listPreview?.subtitle)) {
      const f = schema.fields.find((x) => x.name === name)
      want(f, refId(doc[name]))
    }
    if (allRefs)
      for (const f of schema.fields) {
        if (f.type === 'reference') want(f, doc[f.name])
        if (f.type === 'arrayOf' && f.of?.type === 'reference') for (const item of (doc[f.name] as unknown[]) ?? []) want(f.of, refId(item))
      }
  }
  await Promise.all([...byType].map(([type, ids]) => ensureDocs(qc, type.split(','), [...ids])))
  return [...byType.values()].flatMap((ids) => [...ids].map((id) => qc.getQueryData<Doc | null>(['doc', id])).filter((d): d is Doc => !!d))
}

/** The structure tool; its shell and its panes are two mounts (the list prefs start again from the chain's). */
export const StructureView = (data: PanesData) => <StructureTool key={data.deferred ? 'shell' : 'panes'} {...data} />

function StructureTool({panes, widthHint, listPrefs, resume, deferred}: PanesData) {
  resumeLive(resume)
  // The server sent the shell (Barkpark was slow): the browser runs the pane chain now.
  const router = useRouter()
  useEffect(() => void (deferred && router.invalidate()), [deferred, router])
  const [prefs, setPrefs] = useState(listPrefs)
  const set = (type: string, p: ListPrefs[string]) =>
    setPrefs((all) => {
      const next = {...all, [type]: {...all[type], ...p}}
      writeListPrefs(next)
      return next
    })
  return (
    <ListPrefsContext.Provider value={{prefs, set}}>
      <PresenceStream />
      <Reconnecting />
      <Navbar />
      <Structure panes={panes} widthHint={widthHint} />
    </ListPrefsContext.Provider>
  )
}

/** One presence stream for the tab (J07). */
function PresenceStream() {
  usePresenceStream()
  // Signed in, the editor's own tabs are left out of the room (Sanity's); shared, no one is.
  const self = useQuery(meQuery).data?.presenceName ?? null
  useEffect(() => setPresenceSelf(self), [self])
  return null
}

/** J50: "Trying to connect…" while reads or the live stream keep failing; "Live updates paused" while Barkpark refuses the server's stream. */
function Reconnecting() {
  useReconnectingToast()
  useLivePausedToast()
  return null
}
