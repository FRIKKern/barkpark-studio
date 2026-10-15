// What a token may do, from Barkpark's GET /v1/auth/token (server/auth.ts describeToken):
// its permissions as far as its seat in this workspace allows, whether it may publish
// (a Contributor seat, barkpark #22762, writes drafts only) and the dataset it is held
// to when bound (#22393). Pure, so the seat rules have a fast test.

// `elsewhere`: an API token of another workspace (a dev sign-in's is minted for one).
export type TokenSelf = {permissions: string[]; boundDataset: string | null; refused?: boolean; canPublish?: boolean; elsewhere?: boolean}
type Can = Record<string, boolean>
export type TokenBody = {kind?: string; permissions?: string[]; seat?: {can?: Can}; workspace?: {slug?: string}; seats?: {workspace?: {slug?: string}; can?: Can}[]; dataset?: string; dataset_bound?: boolean}

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
    ...(!!me.workspace?.slug && me.workspace.slug !== workspace && {elsewhere: true}),
  }
}

/**
 * May this request read with the studio's own token (server/barkpark.ts serviceToken)? With
 * sign-in on, only for an editor whose own token reads this workspace: signed out, or seated
 * elsewhere, it would read what they may not (task-73a9f8eafae5fbf1). `editor`: what their
 * token may do here (describeToken); undefined, nobody is signed in.
 */
export function serviceAccess(editor: TokenSelf | undefined): 'ok' | 'signed_out' | 'no_seat' {
  if (!editor || editor.refused) return 'signed_out'
  return editor.permissions.includes('read') && !editor.elsewhere ? 'ok' : 'no_seat'
}
