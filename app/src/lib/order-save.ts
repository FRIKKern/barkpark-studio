import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset, requestToken} from '../server/barkpark'
import {currentEditor, signOut} from '../server/auth'
import {expectEcho} from '../server/listen'
import {writeFaultFor} from '../server/write-faults'
import {isRank, RANK_FIELD, rankBatches} from './order-rank'
import type {Doc} from './data'

// A manual-order move, written (lib/order-rank.ts makes the ranks). Sanity's plugin patches
// a document's draft and its published version together, so a new order never waits for a
// publish. Barkpark, per document:
//
//   published, no draft   the published document itself, by Barkpark's exact-id mutate
//                         (/v<date>/data/mutate: a bare id is the published row). Live at once.
//   a draft (alone, or    the draft (/v1's draft-first patch). Barkpark refuses a write to the
//   over a published one) published twin while its draft exists (409 "would discard that
//                         draft"), so that document's new place goes live when it is published.
//
// A write to /v1 for a published document with no draft would make a draft of it (every
// row of a reordered menu left "edited"): that is why the first case does not go there.
// `direct: false` (an editor who may not publish) keeps to drafts for every document.

type Json = string | number | boolean | null | Json[] | {[k: string]: Json}
export type RankWrite = {id: string; rank: string; direct: boolean}
/** Sanity's API date; any `v<version>` but v1 is Barkpark's exact-id route. */
const EXACT = 'v2025-02-19'

const throwLost = (): never => {
  throw new Error(`mutate 401: ${JSON.stringify({error: {code: 'session_lost', message: "You've been logged out"}})}`)
}

const send = async (route: string, mutations: Json[]) => {
  const res = await bpFetch(`/${route}/data/mutate/${dataset()}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mutations})})
  const body = (await res.json().catch(() => ({}))) as {results?: {document: Json}[]; error?: {code?: string; message?: string; details?: {id?: string; draft?: string}}}
  return {status: res.status, ok: res.ok, body}
}

export const saveRanks = createServerFn({method: 'POST'})
  .validator((d: {type: string; writes: RankWrite[]}) => d)
  .handler(async ({data}) => {
    const writes = data.writes.filter((w) => typeof w.id === 'string' && !w.id.startsWith('drafts.') && isRank(w.rank))
    if (writes.length !== data.writes.length) throw new Error('mutate 400: {"error":{"code":"bad_request","message":"not a rank"}}')
    // e2e only: a fault set for a document this write names (server/write-faults.ts).
    const fault = writeFaultFor(writes.map((w) => ({patch: {id: w.id}})))
    if (fault?.kind === '500') throw new Error('mutate 500: {"error":{"code":"internal_error","message":"Internal Server Error"}}')
    if (fault?.kind === 'hang') await new Promise((go) => setTimeout(go, fault.ms ?? 0))
    const drafts = new Set(writes.filter((w) => !w.direct).map((w) => w.id))
    const patch = (w: RankWrite, type?: string): Json => ({patch: {id: w.id, ...(type && {type}), set: {[RANK_FIELD]: w.rank}}})
    const docs: Json[] = []
    const waiting: string[] = []
    let failed: string | undefined
    // A refusal. A lost session (J48) ends as every write's does (lib/edits.ts mutate): the
    // editor signs in again. Nothing saved yet: the move failed. Some parts saved: they are
    // handed back with the reason, so the list shows what Barkpark holds.
    const refuse = (r: Awaited<ReturnType<typeof send>>) => {
      if (r.status === 401) {
        if (r.body.error?.code === 'session_lost') throwLost()
        if (currentEditor()) (void signOut(), throwLost())
        throw new Error(`mutate 401: ${JSON.stringify({error: {code: 'token_refused', message: "Barkpark refused this studio's token."}})}`)
      }
      const message = `mutate ${r.status}: ${JSON.stringify({error: {code: r.body.error?.code, message: r.body.error?.message}}).slice(0, 600)}`
      if (!docs.length) throw new Error(message)
      failed = message
    }
    // The published rows, in parts Barkpark takes (lib/order-rank.ts rankBatches). A draft made
    // since the list was read (409 naming it): that document goes to its draft instead, and
    // the rest of its part is asked again.
    direct: for (const part of rankBatches(writes.filter((w) => !drafts.has(w.id)))) {
      let left = part
      for (let tries = 0; left.length; tries++) {
        const r = await send(EXACT, left.map((w) => patch(w)))
        if (r.ok) {
          docs.push(...(r.body.results ?? []).map((x) => x.document))
          break
        }
        const twin = r.status === 409 ? r.body.error?.details?.id : undefined
        if (!twin || !left.some((w) => w.id === twin) || tries >= part.length) {
          refuse(r)
          break direct
        }
        drafts.add(twin)
        left = left.filter((w) => w.id !== twin)
      }
    }
    if (!failed)
      for (const part of rankBatches(writes.filter((w) => drafts.has(w.id)))) {
        const r = await send('v1', part.map((w) => patch(w, data.type)))
        if (!r.ok) {
          refuse(r)
          break
        }
        docs.push(...(r.body.results ?? []).map((x) => x.document))
        waiting.push(...part.map((w) => w.id))
      }
    expectEcho(requestToken(), writes.map((w) => w.id))
    return {docs, waiting, ...(failed && {failed})} as unknown as Json
  })

/** `failed`: Barkpark's refusal of a later part of a long list; `docs` are the parts saved before it. */
export type RankSaved = {docs: Doc[]; waiting: string[]; failed?: string}
