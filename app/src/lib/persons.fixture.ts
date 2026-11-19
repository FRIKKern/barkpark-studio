// People for the tests, made as the studio makes them (conditions.ts currentUserOf): a Person
// is sealed, so no test or lock site writes one by hand. For the tests only (person-scan.test.ts).
import {currentUserOf} from './conditions.ts'

/** Someone signed in whose role is `role`, under Sanity's name (`editor`, `administrator`, a workspace's own). */
export const known = (role: string, who: {id?: string; name?: string; email?: string} = {}) =>
  currentUserOf({email: who.email ?? 'a@example.com', name: who.name ?? 'A', userId: who.id ?? 'u1', role, canWrite: true})
/** Nobody signed in (shared sign-in). */
export const nobody = currentUserOf({email: null, name: null, userId: null, role: null, canWrite: true})

