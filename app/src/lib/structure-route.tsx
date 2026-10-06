import type {QueryClient} from '@tanstack/react-query'
import {Navbar} from '../components/Navbar'
import {Structure} from '../components/Structure'
import {docQuery, ensureDocs, refId, fetchViewportHint, listQuery, refTypesOf, schemaOf, schemasQuery, type Doc, type Field, type Schema} from './data'
import {parsePanes, type Pane} from './panes'
import {meQuery} from './session'
import {fetchListPrefs, ListPrefsContext, readListPrefsCookie, writeListPrefs, type ListPrefs} from './list-prefs'
import {useState} from 'react'
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
  const panes = parsePanes(splat)
  const onServer = typeof window === 'undefined'
  const [schemas, widthHint, listPrefs] = await Promise.all([
    queryClient.ensureQueryData(schemasQuery),
    onServer ? fetchViewportHint() : document.querySelector('[data-testid=panes]')?.clientWidth ?? window.innerWidth,
    onServer ? (fetchListPrefs() as Promise<ListPrefs>) : readListPrefsCookie(),
  ])
  // The list and the open docs don't depend on each other: one round trip, not two.
  const [listed, open] = await Promise.all([
    Promise.all(panes.flatMap((p) => (p.kind === 'list' ? [queryClient.ensureQueryData(listQuery(p.type))] : []))),
    Promise.all(panes.flatMap((p) => (p.kind === 'doc' ? [queryClient.ensureQueryData(docQuery(p.type, p.id))] : []))),
  ])
  const openDocs = open.filter((d): d is Doc => !!d)
  const refs = (async () => {
    // Level 1: what open docs reference, and what every visible preview needs.
    const l1 = await ensureRefs(queryClient, schemas, [...openDocs.map((d) => [d, true] as const), ...listed.flat().map((d) => [d, false] as const)])
    // Level 2: the subtitles of those references' own previews.
    await ensureRefs(queryClient, schemas, l1.map((d) => [d, false] as const))
  })()
  if (onServer) await refs
  else void refs.catch(() => {}) // a preview that fails shows its own state
  return {panes, widthHint, listPrefs}
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
    const sub = schema.listPreview?.subtitle
    if (sub?.includes('.')) {
      const f = schema.fields.find((x) => x.name === sub.split('.')[0])
      want(f, doc[f?.name ?? ''])
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

export function StructureView({panes, widthHint, listPrefs}: {panes: Pane[]; widthHint: number; listPrefs: ListPrefs}) {
  const [prefs, setPrefs] = useState(listPrefs)
  const set = (type: string, p: ListPrefs[string]) =>
    setPrefs((all) => {
      const next = {...all, [type]: {...all[type], ...p}}
      writeListPrefs(next)
      return next
    })
  return (
    <ListPrefsContext.Provider value={{prefs, set}}>
      <Navbar />
      <Structure panes={panes} widthHint={widthHint} />
    </ListPrefsContext.Provider>
  )
}
