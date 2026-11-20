import type {Query} from '@tanstack/react-query'

/** A read that has failed and is being tried again (or waits for the network): what "Trying to connect…" (lib/connection.ts) counts. */
export const struggling = (q: Query) => q.state.fetchFailureCount > 0 && q.state.fetchStatus !== 'idle'
