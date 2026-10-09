import {createServerFn} from '@tanstack/react-start'
import {bpFetch, bpRoot, dataset, requestToken, scope} from '../server/barkpark'
import {describeToken} from '../server/auth'

// J64: sharing a preview. Barkpark mints a link to one document, draft included
// (`POST /v1/shares/preview-links`, 24 h; any write member since Barkpark #22488); the
// site takes its token (`?bp-share=`) and shows that document's draft on the page.
// Barkpark keeps only the token's hash, so the link is shown once: this browser
// remembers it (localStorage) while it is live. Listing and revoking links stay
// admin-only: a member sees the link this browser made, and it runs out by itself.

type Link = {id: string; doc_id: string; expires_at: string; revoked_at: string | null}
/** `listed: false`: Barkpark lists links only to an admin; the page knows what it made. */
export type ShareState = {allowed: false} | {allowed: true; listed: boolean; active: {id: string; expiresAt: string}[]}

const where = () => {
  const at = scope()
  return `${at.workspace}/${at.project}/${at.dataset}`
}

/** Whether this editor may share, and the document's live links. */
export const shareState = createServerFn({method: 'GET'})
  .validator((d: {type: string; id: string}) => d)
  .handler(async ({data}): Promise<ShareState> => {
    // Minting needs write (a read-only seat is refused): the token says what it may do.
    const self = await describeToken(requestToken())
    if (self.refused || !self.permissions.includes('write')) return {allowed: false}
    // A link names the id it was made for: the draft's, or the published one.
    const read = (id: string) => bpRoot(`/v1/shares/preview-links?${new URLSearchParams({scope: where(), ref_type: data.type, doc_id: id})}`)
    const answers = await Promise.all([read(data.id), read(`drafts.${data.id}`)])
    if (answers.some((r) => r.status === 401 || r.status === 403)) return {allowed: true, listed: false, active: []}
    const bad = answers.find((r) => !r.ok)
    if (bad) throw new Error(`Barkpark preview links → ${bad.status}`)
    const links = (await Promise.all(answers.map((r) => r.json() as Promise<{links?: Link[]}>))).flatMap((b) => b.links ?? [])
    const now = Date.now()
    return {allowed: true, listed: true, active: links.filter((l) => !l.revoked_at && Date.parse(l.expires_at) > now).map((l) => ({id: l.id, expiresAt: l.expires_at}))}
  })

export const mintShare = createServerFn({method: 'POST'})
  .validator((d: {type: string; id: string}) => d)
  .handler(async ({data}) => {
    const res = await bpRoot('/v1/shares/preview-links', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({scope: where(), ref_type: data.type, doc_id: data.id, label: 'Shared from Presentation'}),
    })
    if (!res.ok) throw new Error(res.status === 403 ? "You don't have permission to share previews." : `Barkpark preview links → ${res.status}`)
    const body = (await res.json()) as {token: string; link: Link}
    return {token: body.token, id: body.link.id, expiresAt: body.link.expires_at}
  })

/** False when Barkpark refuses (only an admin may revoke a link). */
export const revokeShares = createServerFn({method: 'POST'})
  .validator((ids: string[]) => ids)
  .handler(async ({data}) => {
    const answers = await Promise.all(data.map((id) => bpRoot(`/v1/shares/preview-links/${encodeURIComponent(id)}`, {method: 'DELETE'})))
    if (answers.some((r) => r.status === 401 || r.status === 403)) return false
    const bad = answers.find((r) => !r.ok && r.status !== 404)
    if (bad) throw new Error(`Barkpark preview links → ${bad.status}`)
    return true
  })

/**
 * Preview tokens for the site's reads, minted with the signed-in editor's own token on
 * the scoped route (Barkpark #22468: any write-capable member may; held to the editor's
 * workspace, project and dataset). Each is single-use (one /v1/preview read, or one
 * listen stream), so the site asks for as many as it is about to read. Null when this
 * editor may not mint (the site then shows what is published).
 */
export const mintPreviewTokens = createServerFn({method: 'POST'})
  .validator((n: number) => Math.min(Math.max(1, Math.floor(n) || 1), 4))
  .handler(async ({data: n}) => {
    const one = async () => {
      const res = await bpFetch('/v1/preview-tokens', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({dataset: dataset()})})
      if (res.status === 401 || res.status === 403) return null
      if (!res.ok) throw new Error(`Barkpark preview token → ${res.status}`)
      return ((await res.json()) as {token: string}).token
    }
    const tokens = await Promise.all(Array.from({length: n}, one))
    return tokens.every((x): x is string => !!x) ? tokens : null
  })
