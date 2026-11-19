// task-4ffed14fbf52dc47: whether this render may differ from the server's. The server, and the
// browser while it hydrates the server's page, draw the person as unknown; the browser believes
// who-am-I's answer only after (lib/person-source.ts, components/PersonCheckBanner.tsx), so both
// draw the same first frame (no hydration mismatch, React #418).
import {useSyncExternalStore} from 'react'

const none = () => () => {}

/** false on the server and in a hydrating render (a late Suspense subtree too), true after. */
export const useHydrated = (): boolean => useSyncExternalStore(none, () => true, () => false)
