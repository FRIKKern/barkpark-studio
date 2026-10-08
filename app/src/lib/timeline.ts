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

/** Every entry, publish groups opened up, newest first: what the From / To pickers offer. */
export const flatEntries = (entries: HistoryEntry[]): HistoryEntry[] => entries.flatMap((e) => [e, ...(e.children ?? [])])

/**
 * Review changes between two points of the timeline, as Sanity's From / To:
 * From an entry means the state just before its changes (`base`; none = before
 * the document existed), To an entry the state at it (`target`; none = now). The
 * revisions in between, newest first, are the ones whose authors are credited.
 */
export function reviewRange(revisions: Revision[], from: HistoryEntry, to: HistoryEntry | null): {base?: Revision; target?: Revision; between: Revision[]} {
  const at = (id: string) => revisions.findIndex((r) => r.id === id)
  const oldest = at(from.revision.id) + from.count - 1
  const newest = to ? at(to.revision.id) : 0
  return {base: revisions[oldest + 1], target: to ? revisions[newest] : undefined, between: revisions.slice(newest, oldest + 1)}
}

/** From can be any entry older than To; To any entry newer than From's start. */
export function rangeOptions(revisions: Revision[], all: HistoryEntry[], from: HistoryEntry, to: HistoryEntry | null) {
  const at = (id: string) => revisions.findIndex((r) => r.id === id)
  const toAt = to ? at(to.revision.id) : 0
  const fromStart = at(from.revision.id) + from.count - 1
  return {from: all.filter((e) => at(e.revision.id) + e.count - 1 >= toAt), to: all.filter((e) => at(e.revision.id) <= fromStart)}
}
