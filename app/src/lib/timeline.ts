// J16: Sanity's history timeline, as plain data (no server imports, so it is unit-tested).

export type Revision = {
  id: string
  action: string
  status: 'draft' | 'published'
  timestamp: string
  title?: string
  actorId?: string
  author: string
}

/** Sanity's words for what happened. Each new draft (after a publish, or the first) is "Draft created". */
export function actionLabel(r: Revision): string {
  switch (r.action) {
    case 'publish':
      return 'Published'
    case 'unpublish':
      return 'Unpublished'
    case 'delete':
      return r.status === 'draft' ? 'Discarded draft' : 'Deleted'
    case 'create':
      return 'Draft created'
    case 'restore':
      return 'Restored'
    default:
      return 'Edited'
  }
}

export type HistoryEntry = {revision: Revision; label: string; count: number; children?: HistoryEntry[]}
/**
 * The timeline, newest first, as Sanity's: a run of edits by one author folds into
 * one "Edited" entry; each "Published" holds the draft's edits that it published
 * (collapsed under it), while edits since the last publish stay on top. Each entry
 * points at its newest revision.
 */
export function timeline(revisions: Revision[]): HistoryEntry[] {
  const fold = (list: HistoryEntry[], r: Revision) => {
    const label = actionLabel(r)
    const last = list.at(-1)
    if (last && label === 'Edited' && last.label === 'Edited' && last.revision.actorId === r.actorId) last.count++
    else list.push({revision: r, label, count: 1})
  }
  const out: HistoryEntry[] = []
  let publish: HistoryEntry | undefined
  for (const r of revisions) {
    const draftWrite = r.status === 'draft' && (r.action === 'create' || r.action === 'update')
    if (draftWrite && publish) fold((publish.children ??= []), r)
    else if (draftWrite) fold(out, r)
    else {
      fold(out, r)
      publish = r.action === 'publish' ? out.at(-1) : undefined
    }
  }
  return out
}
