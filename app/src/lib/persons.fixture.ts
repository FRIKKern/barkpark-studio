// People for the tests, made as the studio makes them: by the one maker (conditions.ts
// takeMint), which this module takes in a test run, as lib/person-source.ts does in the studio.
// For the tests only (person-scan.test.ts).
import {takeMint} from './conditions.ts'

/** whoAmI's answer as a person (person-source.ts's currentUserOf). */
export const mint = takeMint()
/** Someone signed in whose role is `role`, under Sanity's name (`editor`, `administrator`, a workspace's own). */
export const known = (role: string, who: {id?: string; name?: string; email?: string} = {}) => mint({email: who.email ?? 'a@example.com', name: who.name ?? 'A', userId: who.id ?? 'u1', role, canWrite: true})
/** Nobody signed in (shared sign-in). */
export const nobody = mint({email: null, name: null, userId: null, role: null, canWrite: true})
/** Not known yet: whoAmI not read. */
export const unknown = mint(undefined)
