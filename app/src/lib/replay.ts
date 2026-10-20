/**
 * What a stream replays to a page resuming at an earlier position: of the frames since, in
 * order, each document's last (draft and published as one document). A frame carries the
 * doc as it then read, so the last says it all; an earlier one for a doc deleted since put
 * it back on a list read without it until the delete's frame came.
 */
export function lastPerDoc<F extends {id: number; docId: string}>(frames: F[]): F[] {
  const doc = (id: string) => (id.startsWith('drafts.') ? id.slice(7) : id)
  const last = new Map(frames.map((f) => [doc(f.docId), f.id]))
  return frames.filter((f) => last.get(doc(f.docId)) === f.id)
}
