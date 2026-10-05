// The pane chain lives in the URL, in Sanity's own format so the same deep link
// opens the same panes in both studios:
//   /structure/post;post-01;author-alan,type=author,parentRefPath=author
// segment 0 = the type list, then one doc per segment. Params are URI-encoded.
export type Pane =
  | {kind: 'types'}
  | {kind: 'list'; type: string}
  | {kind: 'doc'; id: string; type: string; parentRefPath?: string}

export function parsePanes(splat: string | undefined): Pane[] {
  const panes: Pane[] = [{kind: 'types'}]
  const segs = (splat ?? '').split(';').filter(Boolean)
  if (segs.length === 0) return panes
  const listType = segs[0]
  panes.push({kind: 'list', type: listType})
  for (const seg of segs.slice(1)) {
    const [id, ...params] = seg.split(',')
    const p = Object.fromEntries(params.map((kv) => kv.split('=').map(decodeURIComponent)))
    panes.push({kind: 'doc', id: decodeURIComponent(id), type: p.type ?? listType, parentRefPath: p.parentRefPath})
  }
  return panes
}

export function panesPath(panes: Pane[]): string {
  const segs: string[] = []
  for (const p of panes) {
    if (p.kind === 'list') segs.push(p.type)
    if (p.kind === 'doc') {
      const list = panes.find((x) => x.kind === 'list')
      const params = p.parentRefPath
        ? `,type=${encodeURIComponent(p.type)},parentRefPath=${encodeURIComponent(p.parentRefPath)}`
        : list?.kind === 'list' && list.type === p.type
          ? ''
          : `,type=${encodeURIComponent(p.type)}`
      segs.push(encodeURIComponent(p.id) + params)
    }
  }
  return segs.length ? `/structure/${segs.join(';')}` : '/structure'
}

/** Href for opening `next` to the right of pane `index` (everything right of it is replaced). */
export const openAfter = (panes: Pane[], index: number, next: Pane) => panesPath([...panes.slice(0, index + 1), next])
/** Href for closing pane `index` and everything to its right. */
export const closeFrom = (panes: Pane[], index: number) => panesPath(panes.slice(0, index))

export const paneKey = (p: Pane) => (p.kind === 'types' ? 'types' : p.kind === 'list' ? `list:${p.type}` : `doc:${p.id}`)
