// The workspace's people, for every people picker (J40 @mentions, J66 task assignee):
// users with an email, not revoked. Barkpark lists API tokens as members too, and they
// far outnumber people (studio-parity, 2026-10-11: 252 tokens, 17 people), so a picker
// that listed members as they come showed tokens and missed people past the first page.

// `display_name`: what Barkpark calls the person, once its roster carries it (Barkpark board
// ask task-2eae7f4056c3a970); until then the people are named by their email's local part.
type Member = {identity?: string; principal_type: string; revoked?: boolean | null; display_name?: string | null}
type MembersPage = {members: Member[]; hasMore?: boolean; nextOffset?: number}

/** A member who is a person: a user with an email, not revoked (never an API token). */
export const isPerson = (m: Member): m is Member & {identity: string} => m.principal_type === 'user' && !m.revoked && !!m.identity?.includes('@')

/** Every page of the members: its people's emails, sorted, and the names Barkpark gives them. */
export async function workspaceRoster(page: (offset: number) => Promise<MembersPage>, maxPages = 20): Promise<{people: string[]; names: Record<string, string>}> {
  const people = new Set<string>()
  const names: Record<string, string> = {}
  let offset = 0
  for (let i = 0; i < maxPages; i++) {
    const {members, hasMore, nextOffset} = await page(offset)
    for (const m of members)
      if (isPerson(m)) {
        people.add(m.identity)
        const name = m.display_name?.trim()
        if (name) names[m.identity] = name
      }
    if (!hasMore || nextOffset === undefined || nextOffset <= offset) break
    offset = nextOffset
  }
  return {people: [...people].sort(), names}
}

/** Every page of the members, its people's emails, sorted (the people may sit past the first page). */
export const workspacePeople = async (page: (offset: number) => Promise<MembersPage>, maxPages = 20) => (await workspaceRoster(page, maxPages)).people
