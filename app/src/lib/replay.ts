/**
 * What a stream replays to a page resuming from a mark taken before its reads: the frames
 * since, in order, without those a later delete of the same document makes moot. Such a
 * frame (an update of a doc deleted since) put the doc back on a list read without it,
 * until the delete's frame came; the delete's frame makes the page read again anyway.
 * `docId` is the published id (a draft and its published doc are one).
 */
export function withoutDeleted<F extends {id: number; docId: string; mutation?: string}>(frames: F[]): F[] {
  const deleted = new Map<string, number>()
  for (const f of frames) if (f.mutation === 'delete') deleted.set(f.docId, f.id)
  return frames.filter((f) => f.id >= (deleted.get(f.docId) ?? -Infinity))
}
