// Barkpark refuses a mutate with more than 50 deletes (#22499: 400 batch_too_large,
// details.kind "delete"; each delete checks every reference field for referrers). Every
// sender splits through here: requests in order, each with at most MAX_DELETES deletes.
export const MAX_DELETES = 50

/** `mutations` as the requests to send, in order; anything but a delete never splits a request. */
export function batches(mutations, maxDeletes = MAX_DELETES) {
  const out = [[]]
  let deletes = 0
  for (const m of mutations) {
    const isDelete = !!(m && typeof m === 'object' && 'delete' in m)
    if (isDelete && deletes === maxDeletes) (out.push([]), (deletes = 0))
    out.at(-1).push(m)
    if (isDelete) deletes++
  }
  return out.filter((b) => b.length)
}
