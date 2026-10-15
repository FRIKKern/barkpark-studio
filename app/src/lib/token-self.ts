// What a token may do, from Barkpark's GET /v1/auth/token (server/auth.ts describeToken):
// its permissions as far as its seat in this workspace allows, whether it may publish
// (a Contributor seat, barkpark #22762, writes drafts only) and the dataset it is held
// to when bound (#22393). Pure, so the seat rules have a fast test.

export type TokenSelf = {permissions: string[]; boundDataset: string | null; refused?: boolean; canPublish?: boolean}
type Can = Record<string, boolean>
export type TokenBody = {kind?: string; permissions?: string[]; seat?: {can?: Can}; seats?: {workspace?: {slug?: string}; can?: Can}[]; dataset?: string; dataset_bound?: boolean}

export function tokenSelf(me: TokenBody, workspace: string): TokenSelf {
  // A login session (#22783): its seat in this workspace says what it may do; none, nothing.
  if (me.kind === 'session') {
    const can = me.seats?.find((s) => s.workspace?.slug === workspace)?.can ?? {}
    return {permissions: ['read', 'write', 'admin'].filter((p) => can[p]), boundDataset: null, canPublish: can.publish !== false}
  }
  return {
    permissions: (me.permissions ?? ['read', 'write']).filter((p) => me.seat?.can?.[p] !== false),
    boundDataset: me.dataset_bound && me.dataset ? me.dataset : null,
    canPublish: me.seat?.can?.publish !== false,
  }
}
