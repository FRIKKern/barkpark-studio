import {queryOptions, replaceEqualDeep} from '@tanstack/react-query'
import {roleRules, type FieldConditions} from './conditions.ts'

// task-4ffed14fbf52dc47: who-am-I's query, and which of its answers the session made. Only an
// answer whoAmI's queryFn returned in the browser is the session's: nothing registers on the
// server or on hydrate, so an answer in the server-rendered page, a cache write under any key, a
// stand-in client or a look-alike is no answer of the session's, and the person stays unknown
// (lib/person-source.ts). The register is the closure's own: no module exports it, and another
// meQueryOf registers into its own set, never the session's (lib/session.ts holds that one).

/** Frozen all the way down, so an answer the session made cannot be changed afterwards. */
function frozen<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const x of Object.values(v)) frozen(x)
  }
  return v
}

/**
 * who-am-I's query on `read`, and `isMade`: whether an answer is one this query's queryFn returned
 * in the browser. A refetch with the same answer keeps the answer it had, if that one was made
 * here (the person stays the same object); any other answer is the fetch's own.
 */
export function meQueryOf<T extends object>(read: () => Promise<T>) {
  const made = new WeakSet<object>()
  const isMade = (me: unknown) => typeof me === 'object' && me !== null && made.has(me)
  const query = queryOptions({
    queryKey: ['me'],
    queryFn: async (): Promise<T> => {
      const me = await read()
      if (typeof window !== 'undefined' && typeof me === 'object' && me !== null) made.add(frozen(me))
      return me
    },
    structuralSharing: (old: unknown, next: unknown) => (isMade(old) && replaceEqualDeep(old, next) === old ? old : next),
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
