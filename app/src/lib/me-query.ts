import {queryOptions, replaceEqualDeep} from '@tanstack/react-query'
import {roleRules, type FieldConditions} from './conditions.ts'

// task-4ffed14fbf52dc47: who-am-I's query, and which of its answers the session made. Only the
// answer whoAmI's latest completed ask returned in the browser is the session's: nothing on the server
// or from hydrate is, a failed ask clears it, so an answer in the server-rendered page, an
// older answer written back, a cache write under any key, a stand-in client or a look-alike is no
// answer of the session's, and the person stays unknown (lib/person-source.ts). The latest is the
// closure's own: no module exports it, and another meQueryOf keeps its own, never the session's
// (lib/session.ts holds that one).

/** Frozen all the way down, so an answer the session made cannot be changed afterwards. */
function frozen<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const x of Object.values(v)) frozen(x)
  }
  return v
}

/**
 * who-am-I's query on `read`, and `isMade`: whether an answer is the one the session's latest
 * completed ask returned in the browser. Nothing else is: not an older answer of its own (kept and
 * written back over a failed ask), and nothing while the latest ask failed, or while one runs after
 * a failure. A refetch with the same answer keeps the answer it had (the person stays the same
 * object); any other answer is the fetch's own.
 */
export function meQueryOf<T extends object>(read: () => Promise<T>) {
  /** The latest completed ask's answer; null before one, after a failed one and until the next answers. */
  let current: object | null = null
  /** The answer that was the latest when the newest ask began: the one a same answer keeps. */
  let before: object | null = null
  /** Asks begun; only the newest one's outcome counts (an ask the query dropped answers to no one). */
  let asks = 0
  const isMade = (me: unknown) => current !== null && me === current
  const query = queryOptions({
    queryKey: ['me'],
    queryFn: async (): Promise<T> => {
      const ask = ++asks
      before = current
      let me: T
      try {
        me = await read()
      } catch (e) {
        if (ask === asks) current = null
        throw e
      }
      if (ask === asks) current = typeof window !== 'undefined' && typeof me === 'object' && me !== null ? frozen(me) : null
      return me
    },
    structuralSharing: (old: unknown, next: unknown) => {
      if (!(isMade(next) && before !== null && old === before && replaceEqualDeep(old, next) === old)) return next
      // The same answer again: the answer it had stays, and is the latest.
      current = old
      return old
    },
    staleTime: 30_000,
    // Re-asked when the window regains focus (J48): a session lost to a studio restart or
    // an expired cookie shows up before the next edit, not only after it.
    refetchOnWindowFocus: true,
  })
  return {query, isMade}
}

/**
 * Whether the browser asks who-am-I again right after load: the server render stood in for a late
 * Barkpark (provisional), as before; or a role rule waits on the person and the answer in the page
 * is not one the session made (it came with the server render). A config with no role rule sends
 * nothing more than before.
 */
export const asksAgain = (me: {provisional?: boolean} | undefined, isMade: (me: unknown) => boolean, rules: Record<string, FieldConditions> | undefined) =>
  !!me && (!!me.provisional || (roleRules(rules) && !isMade(me)))
