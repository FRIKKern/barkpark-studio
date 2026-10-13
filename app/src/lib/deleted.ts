// Was this missing doc deleted? From its history, newest first (J32). A doc that has a
// history but whose newest revision is not the delete may be one whose delete has not
// reached the history yet (its live frame or the held save's 404 can come first: CI,
// #546's first run, showed "not found" instead of the deleted banner and its kept
// edits). So it is read again a few times before it counts as not deleted.

/** How many reads of the history before a doc with history but no delete is "not found". */
export const DELETE_READS = 8

/** `true` deleted, `false` not (a new id, or no delete after DELETE_READS reads), `undefined` not known yet. */
export function deletedState(revisions: {action: string}[] | undefined, reads: number, failed: boolean): boolean | undefined {
  if (failed) return false
  if (!revisions) return undefined
  if (revisions[0]?.action === 'delete') return true
  if (revisions.length === 0) return false
  return reads < DELETE_READS ? undefined : false
}

/** Read the history again (ms) while the answer is not known yet; `false` to stop. */
export const deletedPoll = (revisions: {action: string}[] | undefined, reads: number) =>
  revisions && revisions.length > 0 && revisions[0]?.action !== 'delete' && reads < DELETE_READS ? 1000 : false
