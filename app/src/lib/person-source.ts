// Where a person comes from (lib/conditions.ts Person): whoAmI's answer, made into a person by
// the one maker, which this module takes as it loads (conditions.ts takeMint). Its own module, not
// lib/session.ts: the server loads a module with server functions twice (itself and its
// server-function half), and the maker is handed out once.
import {useQuery, type QueryClient} from '@tanstack/react-query'
import {useMemo} from 'react'
import {giveMintBack, takeMint} from './conditions'
import {meQuery} from './session'

const currentUserOf = takeMint()
// A dev reload of this module hands the maker back first, so its next run takes it again.
import.meta.hot?.dispose(() => giveMintBack(currentUserOf))

/**
 * Sanity's useCurrentUser: the person a field is judged for: known, nobody, or unknown. With
 * personOf, the only source of a person (person-scan.test.ts): a lock site takes it whole and
 * hands it to the rule.
 */
export function useCurrentUser() {
  const me = useQuery(meQuery).data
  return useMemo(() => currentUserOf(me), [me])
}
/** The same outside a component: the person as the cached whoAmI says. */
export const personOf = (qc: QueryClient) => currentUserOf(qc.getQueryData(meQuery.queryKey) ?? undefined)
