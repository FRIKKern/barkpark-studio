// J34: a list input (tags) whose changes come back as its `value` a moment later. A fast
// second Enter (or ×) before the first is back must build on what was sent, not on the
// lagging `value`, or it overwrites the change before it (J13 re-recording: one, two,
// three, four ended as one, three, four). Plain data, so it is unit-tested.

/** What was sent and not yet back: the lists in order, and the value they started from. */
export type Pending = {from: string[]; lists: string[][]} | null

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The pending lists against this render's `value`: gone once `value` is the last of them, or
 * once `value` is none of them nor where they started (someone else's edit, a refusal).
 */
export function settle(pending: Pending, value: string[]): Pending {
  if (!pending) return null
  const {from, lists} = pending
  return same(value, lists.at(-1)!) || !(same(value, from) || lists.some((l) => same(l, value))) ? null : pending
}

/** The list to show and to build the next change on. */
export const shown = (pending: Pending, value: string[]) => pending?.lists.at(-1) ?? value

/** `next` sent: it counts until `value` catches up with it. */
export const sent = (pending: Pending, value: string[], next: string[]): Pending => ({from: pending?.from ?? value, lists: [...(pending?.lists ?? []), next]})
