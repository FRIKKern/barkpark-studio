// The pane chain lives in the URL, in Sanity's own format so the same deep link
// opens the same panes in both studios:
//   /structure/post;post-01;author-alan,type=author,parentRefPath=author
// segment 0 = the type list, then one doc per segment. Params are URI-encoded.
// A split (J26) puts siblings in one segment, joined by "|"; an empty sibling id
// means the same doc as the first: /structure/post;post-26|,view=json
export type Pane =
  | {kind: 'types'}
  | {kind: 'list'; type: string}
  | {kind: 'doc'; id: string; type: string; parentRefPath?: string; view?: string; sibling?: boolean; inspect?: string; rev?: string; path?: string}

export function parsePanes(splat: string | undefined): Pane[] {
  const panes: Pane[] = [{kind: 'types'}]
  const segs = (splat ?? '').split(';').filter(Boolean)
  if (segs.length === 0) return panes
  const listType = segs[0]
  panes.push({kind: 'list', type: listType})
  for (const seg of segs.slice(1)) {
    let first: Extract<Pane, {kind: 'doc'}> | undefined
    for (const part of seg.split('|')) {
      const [id, ...params] = part.split(',')
      const p = Object.fromEntries(params.filter(Boolean).map((kv) => kv.split('=').map(decodeURIComponent)))
      const pane: Pane = {
        kind: 'doc',
        id: id ? decodeURIComponent(id) : first?.id ?? '',
        type: p.type ?? first?.type ?? listType,
        parentRefPath: p.parentRefPath ?? first?.parentRefPath,
        view: p.view,
        // J16: an inspector open beside the doc (Sanity's `inspect=…/history`), and an
        // old revision shown read-only in its place (`rev=<revision id>`).
        inspect: p.inspect,
        rev: p.rev,
        // J52: the focused field (Sanity's `path=seo.metaTitle`): a reload or a copied
        // link opens on it.
        path: p.path,
        sibling: !!first || undefined,
      }
      first ??= pane
      panes.push(pane)
    }
  }
  return panes
}

export function panesPath(panes: Pane[]): string {
  const segs: string[] = []
  for (const p of panes) {
    if (p.kind === 'list') segs.push(p.type)
    if (p.kind === 'doc') {
      const list = panes.find((x) => x.kind === 'list')
      let params = p.parentRefPath
        ? `,type=${encodeURIComponent(p.type)},parentRefPath=${encodeURIComponent(p.parentRefPath)}`
        : list?.kind === 'list' && list.type === p.type
          ? ''
          : `,type=${encodeURIComponent(p.type)}`
      if (p.view) params += `,view=${encodeURIComponent(p.view)}`
      if (p.inspect) params += `,inspect=${encodeURIComponent(p.inspect)}`
      if (p.rev) params += `,rev=${encodeURIComponent(p.rev)}`
      if (p.path) params += `,path=${encodeURIComponent(p.path)}`
      // A sibling of the same doc carries only its own params, like Sanity's "|,".
      if (p.sibling) segs[segs.length - 1] += `|,${p.view ? `view=${encodeURIComponent(p.view)}` : ''}`
      else segs.push(encodeURIComponent(p.id) + params)
    }
  }
  return segs.length ? `/structure/${segs.join(';')}` : '/structure'
}

/** The last pane of the split group `index` is in (itself when not split). */
export function groupEnd(panes: Pane[], index: number) {
  let end = index
  while (panes[end + 1]?.kind === 'doc' && (panes[end + 1] as {sibling?: boolean}).sibling) end++
  return end
}
/** Whether pane `index` shares its segment with another (a split). */
export const isSplit = (panes: Pane[], index: number) => {
  const p = panes[index]
  return p.kind === 'doc' && (!!p.sibling || groupEnd(panes, index) > index)
}

/** Href for opening `next` to the right of pane `index`'s group (everything right of it is replaced). */
export const openAfter = (panes: Pane[], index: number, next: Pane) => panesPath([...panes.slice(0, groupEnd(panes, index) + 1), next])
/** Href for "Split pane right": the same doc again, beside it in its group. */
export function splitRight(panes: Pane[], index: number) {
  const p = panes[index] as Extract<Pane, {kind: 'doc'}>
  return panesPath([...panes.slice(0, index + 1), {...p, sibling: true}, ...panes.slice(index + 1)])
}
/** Href for "Close split pane": drop just this one; the next sibling takes its place. */
export function closeSplit(panes: Pane[], index: number) {
  const rest = panes.filter((_, i) => i !== index)
  const p = panes[index] as Extract<Pane, {kind: 'doc'}>
  const heir = rest[index]
  if (!p.sibling && heir?.kind === 'doc') rest[index] = {...heir, sibling: undefined}
  return panesPath(rest)
}
/** Href for showing pane `index` in another view ('' = the editor). */
export function withView(panes: Pane[], index: number, view: string) {
  return panesPath(panes.map((p, i) => (i === index && p.kind === 'doc' ? {...p, view: view || undefined} : p)))
}
/** Href for pane `index` with some of its params changed (undefined removes one). */
export function withParams(panes: Pane[], index: number, params: {inspect?: string; rev?: string; path?: string}) {
  return panesPath(panes.map((p, i) => (i === index && p.kind === 'doc' ? {...p, ...params} : p)))
}
/** Href for closing pane `index` and everything to its right. */
export const closeFrom = (panes: Pane[], index: number) => panesPath(panes.slice(0, index))

export const paneKey = (p: Pane) => (p.kind === 'types' ? 'types' : p.kind === 'list' ? `list:${p.type}` : `doc:${p.id}`)
