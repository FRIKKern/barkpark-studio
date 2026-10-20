/**
 * What a stream replays to a page resuming from a mark taken before its reads: the frames
 * since, in order, without those a later delete of the same document makes moot. Such a
 * frame (an update of a doc deleted since) put the doc back on a list read without it,
 * until the delete's frame came; the delete's frame makes the page read again anyway.
 * `docId` is the published id (a draft and its published doc are one); `rawId` the frame's
 * own. Barkpark's force delete of a doc with both names the published id only: it moots
 * both ids' frames. A delete naming the draft (`drafts.X`) moots the draft's frames only,
 * so a publish before it still reaches the page.
 */
export function withoutDeleted<F extends {id: number; docId: string; rawId?: string; mutation?: string}>(frames: F[]): F[] {
  const doc = new Map<string, number>()
  const draft = new Map<string, number>()
  for (const f of frames) if (f.mutation === 'delete') f.rawId?.startsWith('drafts.') ? draft.set(f.rawId, f.id) : doc.set(f.docId, f.id)
  return frames.filter((f) => f.id >= (doc.get(f.docId) ?? -Infinity) && f.id >= (draft.get(f.rawId ?? '') ?? -Infinity))
}
