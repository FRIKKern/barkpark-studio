// The roles the workspace defines, as Barkpark names them (GET /v1/workspace/roles: the built-in
// ones, then custom and global roles A-Z). A paste lock asks a role rule for each of them
// (lib/conditions.ts roleHidden), so a field shown only to a custom role the person lacks is
// kept. Per workspace, the same for every dataset. Read with the signed-in person's own token,
// never the studio's (lib/session.ts workspaceRolesQuery).
export const ROLES_PATH = '/v1/workspace/roles'

/**
 * Barkpark's answer: its role names, or null when it gave none (no such route on that server,
 * a refusal such as no seat or a token bound to another dataset, a failed read, a body not in
 * that shape). Null means today's roles: administrator, editor, contributor, viewer and the
 * person's own, never no lock.
 */
export async function readWorkspaceRoles(get: (path: string) => Promise<Response>): Promise<string[] | null> {
  try {
    const res = await get(ROLES_PATH)
    if (res.status !== 200) return null
    const roles = ((await res.json()) as {roles?: unknown} | null)?.roles
    return Array.isArray(roles) && roles.every((r) => typeof r === 'string' && r !== '') ? roles : null
  } catch {
    return null
  }
}
