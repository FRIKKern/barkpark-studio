// task-349280f0addcf251, its open half: a server render read the content model (the desk and
// the schemas) and only then the URL's list and open docs, one round trip after the other.
// The model is shared for 5 s (server/barkpark.ts SETTLED_MS), so a page loaded later than that
// paid both. Now, on a render the head start let in (lib/gate-head-start.ts: chainMayStart said
// yes, then `me` let this person in), the list and doc reads begin on the model this workspace,
// project and dataset last read, while the fresh one is read. They run on a client of their own,
// with this request's token, after the live stream's resume mark like every document read.
// Only when the fresh model is the same as the remembered one does what they read join the
// page; a changed model drops them and the chain reads as it always did.

/** The content model last read per `<workspace> <project> <dataset>`, at most `cap` of them. */
export function modelMemory<M>(cap = 50) {
  const held = new Map<string, {model: M; text: string}>()
  return {
    get: (key: string) => held.get(key),
    put: (key: string, model: M, text = JSON.stringify(model)) => {
      held.delete(key)
      held.set(key, {model, text})
      if (held.size > cap) held.delete(held.keys().next().value!)
    },
  }
}
export type ModelMemory<M> = ReturnType<typeof modelMemory<M>>

/** Reads begun early: settled when every one of them has, and what they read by then. */
export type Ahead<K> = {done: Promise<unknown>; read: () => [K, unknown][]}

/**
 * The fresh model, read while the reads it leads to run ahead on the remembered one.
 * `ahead` only when the fresh model is the remembered one, read for read (as JSON).
 */
export async function modelWithReadsAhead<M, K>({key, memory, model, begin}: {key: string; memory: ModelMemory<M>; model: Promise<M>; begin: (known: M) => Ahead<K>}): Promise<{model: M; ahead?: Ahead<K>}> {
  const known = memory.get(key)
  const ahead = known ? begin(known.model) : undefined
  const fresh = await model
  const text = JSON.stringify(fresh)
  memory.put(key, fresh, text)
  return known && ahead && known.text === text ? {model: fresh, ahead} : {model: fresh}
}

/** What the reads ahead read, once all have settled, into the page's client: never over what it holds. */
export async function adopt<K>(ahead: Ahead<K> | undefined, has: (key: K) => boolean, put: (key: K, data: unknown) => void) {
  if (!ahead) return
  await ahead.done
  for (const [key, data] of ahead.read()) if (!has(key)) put(key, data)
}
