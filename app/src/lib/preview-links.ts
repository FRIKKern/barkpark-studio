import {createServerFn} from '@tanstack/react-start'
import {bpFetch, bpRoot, dataset, scope} from '../server/barkpark'

// J64: sharing a preview. Barkpark mints a link to one document, draft included
// (`POST /v1/shares/preview-links`, admin only, 24 h; task-6812c3100d7aedbc); the
// site takes its token (`?bp-share=`) and shows that document's draft on the page.
// Barkpark keeps only the token's hash, so the link is shown once: this browser
// remembers it (localStorage) while it is live.

type Link = {id: string; doc_id: string; expires_at: string; revoked_at: string | null}
export type ShareState = {allowed: false} | {allowed: true; active: {id: string; expiresAt: string}[]}

const where = () => {
  const at = scope()
  return `${at.workspace}/${at.project}/${at.dataset}`
}

/** Whether this editor may share, and the document's live links. */
export const shareState = createServerFn({method: 'GET'})
  .validator((d: {type: string; id: string}) => d)
  .handler(async ({data}): Promise<ShareState> => {
    // A link names the id it was made for: the draft's, or the published one.
    const read = (id: string) => bpRoot(`/v1/shares/preview-links?${new URLSearchParams({scope: where(), ref_type: data.type, doc_id: id})}`)
    const answers = await Promise.all([read(data.id), read(`drafts.${data.id}`)])
    if (answers.some((r) => r.status === 401 || r.status === 403)) return {allowed: false}
    const bad = answers.find((r) => !r.ok)
    if (bad) throw new Error(`Barkpark preview links → ${bad.status}`)
    const links = (await Promise.all(answers.map((r) => r.json() as Promise<{links?: Link[]}>))).flatMap((b) => b.links ?? [])
    const now = Date.now()
    return {allowed: true, active: links.filter((l) => !l.revoked_at && Date.parse(l.expires_at) > now).map((l) => ({id: l.id, expiresAt: l.expires_at}))}
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

export const revokeShares = createServerFn({method: 'POST'})
  .validator((ids: string[]) => ids)
  .handler(async ({data}) => {
    await Promise.all(data.map((id) => bpRoot(`/v1/shares/preview-links/${encodeURIComponent(id)}`, {method: 'DELETE'})))
    return true
  })

/**
 * The preview token the site reads drafts with (Barkpark's scoped mint, admin only):
 * multi-use, for the dataset, an hour at most, so the site server holds no editor's
 * credential. Null for an editor who may not mint (the site then shows published).
 */
export const mintPreviewToken = createServerFn({method: 'POST'}).handler(async () => {
  const res = await bpFetch('/v1/preview-tokens', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({dataset: dataset(), multi_use: true, ttl_seconds: 3600}),
  })
  if (res.status === 401 || res.status === 403) return null
  if (!res.ok) throw new Error(`Barkpark preview token → ${res.status}`)
  const {token, expires_at} = (await res.json()) as {token: string; expires_at: string}
  return {token, expiresAt: Date.parse(expires_at)}
})
