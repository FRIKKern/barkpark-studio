import type {QueryClient} from '@tanstack/react-query'
import {usePresenceStream} from './presence'
import {Navbar} from '../components/Navbar'
import {Structure} from '../components/Structure'
import {deskQuery, docQuery, ensureDocs, refId, fetchResumeMark, fetchViewportHint, listQuery, refTypesOf, schemaOf, schemasQuery, type Doc, type Field, type Schema} from './data'
import {deskIndex, deskSort, listFilter, parseDeskPanes, unsupportedOps} from './desk'
import {parseSingletonPanes, type Pane} from './panes'
import {startsAtStudioItem, studioDesk} from './structure-config'
import {previewRefs} from './preview'
import {meQuery} from './session'
import {DEFAULT_SORT, fetchListPrefs, ListPrefsContext, readListPrefsCookie, writeListPrefs, type ListPrefs} from './list-prefs'
import {useState} from 'react'
import {useReconnectingToast} from './connection'
import {resumeLive} from './live'
import {redirect} from '@tanstack/react-router'

// Everything a pane chain needs before it paints: schemas, the list, every open
// doc, and the docs their previews follow (refs + preview subtitles). On a
// reload this runs on the server, so the whole chain arrives in the HTML.
// Referenced docs are fetched per type in one request (one shared token, one
// rate bucket: see server/barkpark.ts).
// In the browser, a pane opens as soon as its own doc is there; references load
// behind it (their previews fill in), so opening never waits on the network for
// data the pane can paint without.
/** With dev sign-in on, the structure needs an editor: send others to /login. */
export async function requireEditor(queryClient: QueryClient, href: string) {
  const me = await queryClient.ensureQueryData(meQuery)
  if (me.devLogin && !me.email) throw redirect({to: '/login', search: {redirect: href}})
}

export async function loadPanes(queryClient: QueryClient, splat: string | undefined) {
  const onServer = typeof window === 'undefined'
  // Before any read: frames after this point reach the page once its stream opens.
  const resume = onServer ? await fetchResumeMark() : undefined
  // B12: a declared desk decides what the URL's segments name.
  // B13: without a desk, a singleton type's segment is its one doc, so schemas come first too.
  const [desk, schemas] = await Promise.all([queryClient.ensureQueryData(deskQuery), queryClient.ensureQueryData(schemasQuery)])
  // J18: without one, the studio's own structure items still name their segments.
  const own = desk ? null : studioDesk()
  const panes = desk ? parseDeskPanes(splat, desk) : own && startsAtStudioItem(splat) ? parseDeskPanes(splat, own) : parseSingletonPanes(splat, new Set(schemas.filter((s) => s.singleton).map((s) => s.name)))
  const nodes = desk ?? own ? deskIndex((desk ?? own)!) : undefined
  const [widthHint, listPrefs] = await Promise.all([
    onServer ? fetchViewportHint() : document.querySelector('[data-testid=panes]')?.clientWidth ?? window.innerWidth,
    onServer ? (fetchListPrefs() as Promise<ListPrefs>) : readListPrefsCookie(),
  ])
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

/** The docs open docs reference, and what every visible preview needs; a preview that fails shows its own state. */
async function followRefs(queryClient: QueryClient, schemas: Schema[], listed: (Doc[] | undefined)[], open: (Doc | null | undefined)[]) {
  const openDocs = open.filter((d): d is Doc => !!d)
  try {
    // Level 1: what open docs reference, and what every visible preview needs.
    const l1 = await ensureRefs(queryClient, schemas, [...openDocs.map((d) => [d, true] as const), ...listed.flat().flatMap((d) => (d ? [[d, false] as const] : []))])
    // Level 2: the subtitles of those references' own previews.
    await ensureRefs(queryClient, schemas, l1.map((d) => [d, false] as const))
  } catch {}
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

export function StructureView({panes, widthHint, listPrefs, resume}: {panes: Pane[]; widthHint: number; listPrefs: ListPrefs; resume?: number | null}) {
  resumeLive(resume)
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
  return null
}

/** J50: "Trying to connect…" while reads or the live stream keep failing. */
function Reconnecting() {
  useReconnectingToast()
  return null
}
