// The roles the workspace defines, read for a paste (lib/paste-reads.ts): with the signed-in
// person's own token, as the schemas are, never the studio's (lib/workspace-roles.ts rolesFor).
// Nobody signed in: none (no role rule locks a paste then).
import {queryOptions} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {currentEditor} from '../server/auth'
import {bpFetch} from '../server/barkpark'
import {rolesFor} from './workspace-roles'

const fetchWorkspaceRoles = createServerFn({method: 'GET'}).handler(async () => rolesFor(currentEditor(), bpFetch))
/** Once per page load, which is one workspace (a scope switch loads the page again). Null: today's roles. */
export const workspaceRolesQuery = queryOptions({queryKey: ['workspace-roles'], queryFn: async () => (await fetchWorkspaceRoles()) as string[] | null, staleTime: Infinity, retry: false})
