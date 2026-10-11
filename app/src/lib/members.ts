// The workspace's people, for every people picker (J40 @mentions, J66 task assignee):
// users with an email, not revoked. Barkpark lists API tokens as members too, and they
// far outnumber people (studio-parity, 2026-10-11: 252 tokens, 17 people), so a picker
// that listed members as they come showed tokens and missed people past the first page.

type Member = {identity?: string; principal_type: string; revoked?: boolean | null}
type MembersPage = {members: Member[]; hasMore?: boolean; nextOffset?: number}

/** A member who is a person: a user with an email, not revoked (never an API token). */
export const isPerson = (m: Member): m is Member & {identity: string} => m.principal_type === 'user' && !m.revoked && !!m.identity?.includes('@')

/** Every page of the members, its people's emails, sorted (the people may sit past the first page). */
export async function workspacePeople(page: (offset: number) => Promise<MembersPage>, maxPages = 20): Promise<string[]> {
  const people = new Set<string>()
  let offset = 0
  for (let i = 0; i < maxPages; i++) {
    const {members, hasMore, nextOffset} = await page(offset)
    for (const m of members) if (isPerson(m)) people.add(m.identity)
    if (!hasMore || nextOffset === undefined || nextOffset <= offset) break
    offset = nextOffset
  }
  return [...people].sort()
}
