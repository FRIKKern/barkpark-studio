// Where a person comes from (lib/conditions.ts Person): whoAmI's answer, made into a person by
// the one maker, which this module takes as it loads (conditions.ts takeMint). Its own module, not
// lib/session.ts: the server loads a module with server functions twice (itself and its
// server-function half), and the maker is handed out once.
import {useQuery, type QueryClient} from '@tanstack/react-query'
import {useMemo} from 'react'
import {giveMintBack, takeMint} from './conditions'
import {useHydrated} from './use-hydrated'
import {madeBySession, meQuery} from './session'

const currentUserOf = takeMint()
// A dev reload of this module hands the maker back first, so its next run takes it again.
import.meta.hot?.dispose(() => giveMintBack(currentUserOf))

/**
 * Sanity's useCurrentUser: the person a field is judged for: known, nobody, or unknown. With
 * personOf, the only source of a person (person-scan.test.ts): a lock site takes it whole and
 * hands it to the rule. Only the session's latest who-am-I answer (lib/me-query.ts) is believed;
 * any other (the server render's, an older one, a cache write, a look-alike) gives unknown. Not
 * while the page hydrates: the server drew the person unknown, so the first frame is the same.
 */
export function useCurrentUser() {
  const me = useQuery(meQuery).data
  const hydrated = useHydrated()
  return useMemo(() => currentUserOf(hydrated && madeBySession(me) ? me : undefined), [me, hydrated])
}
/** The page's own query client, as router.tsx makes it (in the browser: one per page), held once. */
let appClient: QueryClient | undefined
export function holdAppClient(qc: QueryClient) {
  if (typeof window === 'undefined') return
  if (appClient) throw new Error("The page's query client is held already: only router.tsx hands it over, once.")
  appClient = qc
}
/** The same outside a component: the person as the page's own cached whoAmI says (none on the server: unknown). */
export function personOf() {
  const me = appClient?.getQueryData(meQuery.queryKey)
  return currentUserOf(madeBySession(me) ? me : undefined)
}
