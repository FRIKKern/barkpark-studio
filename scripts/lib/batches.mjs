// Barkpark caps the deletes in one mutate (#22508: 500; a batch over it is refused with
// 400/422 batch_too_large, details {kind: "delete", max}). Every sender splits through
// here: requests in order, each with at most MAX_DELETES deletes, and a refusal naming
// a lower cap sends again at that cap.
export const MAX_DELETES = 500

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

/** The lower delete cap a refused request names (batch_too_large), if it is one. */
export async function lowerCap(res, maxDeletes) {
  if (res.status !== 400 && res.status !== 422) return undefined
  const body = await res.clone().json().catch(() => ({}))
  const max = body?.error?.code === 'batch_too_large' && body.error.details?.kind === 'delete' ? Number(body.error.details.max) : NaN
  return max > 0 && max < maxDeletes ? max : undefined
}

/**
 * Send `mutations` in batches with `send(part)` (a fetch Response); a batch_too_large
 * with a lower cap sends that part again at it. Stops at the first other failure and
 * returns that Response, else the last one.
 */
export async function sendBatches(mutations, send, maxDeletes = MAX_DELETES) {
  let last
  for (const part of batches(mutations, maxDeletes)) {
    last = await send(part)
    const cap = await lowerCap(last, maxDeletes)
    if (cap) last = await sendBatches(part, send, cap)
    if (!last.ok) return last
  }
  return last
}
