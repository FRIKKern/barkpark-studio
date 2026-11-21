import type {QueryClient} from '@tanstack/react-query'
import {createServerFn} from '@tanstack/react-start'
import {bpFetch, dataset} from '../server/barkpark'
import {readServerDoc, type Backlink, type Doc} from './data'
import {deleteDoc, discardDraft, mutate, reasonOf, writeSlot} from './edits'
import {unlinkTranslation} from './translations'
import {METADATA_TYPE} from './translation-group'
import {withCopyNulls} from './create-nulls'
import {copyFields, onlyGroupLink, planRow, refusedReferrers, type BulkAction, type Hold, type Perms, type Referrer, type RowResult} from './bulk'

// Bulk delete, duplicate and discard (task-22ce73ad72423b85), one row at a time through the
// single document's own action (lib/edits.ts deleteDoc / discardDraft, the footer's Duplicate,
// lib/translations.ts for a translation's link). Each row is read again right before it runs:
// the confirm's answer may be old by then (another editor published it, deleted it or put a
// reference to it), and Barkpark refuses a referenced delete as well (409, never forced here).

type Fresh = {doc: Doc | null; refs: Backlink[] | null}
type Json = string | number | boolean | null | Json[] | {[k: string]: Json}

/** Who refers to `id` now (null: the lookup failed). A translation group's metadata is the group's own link, not a use (lib/data.ts backlinks). */
async function referrers(id: string): Promise<Backlink[] | null> {
  const b = await bpFetch(`/v1/data/backlinks/${dataset()}/${encodeURIComponent(id)}`, {}, undefined, {fresh: true})
  if (!b.ok) return null
  return ((await b.json()) as {result: {backlinks: Backlink[]}}).result.backlinks.filter((r) => r.type !== METADATA_TYPE).map(({from_doc_id, type, title, via_field}) => ({from_doc_id, type, title, via_field}))
}

/**
 * A row as Barkpark has it now, not a read shared from a moment ago: the editors' version
 * (draft if any), whether a published one exists (when asked), and who refers to it (when
 * asked; null: the lookup failed, which holds a delete back).
 */
const readRow = createServerFn({method: 'GET'})
  .validator((d: {type: string; id: string; published: boolean; refs: boolean}) => d)
  .handler(async ({data}) => {
    const doc = (p: string) => bpFetch(`/v1/data/doc/${dataset()}/${encodeURIComponent(data.type)}/${encodeURIComponent(data.id)}?perspective=${p}`, {}, undefined, {fresh: true})
    const res = await doc('drafts')
    if (res.status === 404) return {doc: null, refs: []}
    if (!res.ok) throw new Error(`Barkpark ${res.status}`)
    const found = ((await res.json()) as {result: Doc}).result
    let published: boolean | undefined
    if (data.published && found._draft) {
      const p = await doc('published')
      if (p.status !== 404 && !p.ok) throw new Error(`Barkpark ${p.status}`)
      published = p.ok
    }
    const refs = data.refs ? await referrers(data.id) : []
    return {doc: {...found, _hasPublished: found._draft ? published : true}, refs} as unknown as Json
  })

const readRefs = createServerFn({method: 'GET'})
  .validator((d: {id: string}) => d)
  .handler(async ({data}) => (await referrers(data.id)) as unknown as Json)

export type RowContext = {
  perms: Perms
  /** The row's type is translated: its translation link goes with it (deleteTranslated). */
  translated: boolean
  /** The copy's id, fixed per row when the dialog opened: a retry after a lost answer finds it, never makes a second. */
  copyId: string
  /** The rank a copy takes in a manually ordered list (components/OrderableRows.tsx copyRank). */
  rank: (from: Doc) => Record<string, unknown>
  /** The row failed before: a write whose answer was lost may have landed, so "gone" or "no draft" now means it did. */
  retrying: boolean
  /** The row's type's initial values: a copy sends null where the original has nothing (lib/create-nulls). */
  initialValues?: Record<string, unknown>
}

const code = (msg: string) => /"code":"(\w+)"/.exec(msg)?.[1]
const failed = (err: unknown): RowResult => {
  const msg = (err as Error).message
  return {state: 'failed', reason: reasonOf(msg) ?? msg}
}
const held = (why: Hold, refs?: Referrer[]): RowResult => ({state: 'skipped', why, ...(refs && {refs})})

/** Run one row of a bulk action, judged again from a fresh read. It never throws: the row's result says. */
export async function runBulkRow(qc: QueryClient, action: BulkAction, id: string, type: string, ctx: RowContext): Promise<RowResult> {
  let fresh: Fresh
  try {
    fresh = (await readRow({data: {type, id, published: action === 'discard' || (action === 'delete' && !ctx.perms.canPublish), refs: action === 'delete'}})) as unknown as Fresh
  } catch (err) {
    return failed(err)
  }
  const {doc} = fresh
  const step = planRow(action, doc && {id, type, draft: doc._draft, published: doc._hasPublished !== false}, fresh.refs ?? undefined, ctx.perms, id)
  if (!step.go) {
    // Asked again after a lost answer: the delete or discard had landed.
    if (ctx.retrying && ((action === 'delete' && step.why === 'gone') || (action === 'discard' && step.why === 'no-changes'))) return {state: 'done'}
    return held(step.why, step.refs)
  }
  if (action === 'duplicate') return duplicate(doc!, ctx)
  if (action === 'discard') {
    await writeSlot()
    try {
      await discardDraft(qc, doc!)
      return {state: 'done'}
    } catch (err) {
      // Published or discarded by someone else between the read and the write.
      if (code((err as Error).message) === 'not_found') return ctx.retrying ? {state: 'done'} : held('no-changes')
      return failed(err)
    }
  }
  return remove(qc, doc!, ctx)
}

async function remove(qc: QueryClient, doc: Doc, ctx: RowContext): Promise<RowResult> {
  const id = doc._publishedId
  await writeSlot()
  try {
    await deleteDoc(qc, doc)
  } catch (err) {
    const msg = (err as Error).message
    if (code(msg) === 'not_found') return ctx.retrying ? {state: 'done'} : held('gone')
    if (code(msg) !== 'document_referenced') return failed(err)
    const who = refusedReferrers(msg)
    // A reference came in after the check (another editor): left alone, and who it is said.
    if (!ctx.translated || !onlyGroupLink(who)) return held('referenced', await referrersNow(id, who))
    // Only its translation group refers to it: the link goes first, then the delete again.
    try {
      if (!(await unlinkTranslation(qc, id))) return held('referenced', await referrersNow(id, who))
      await writeSlot()
      await deleteDoc(qc, doc)
      return {state: 'done'}
    } catch (again) {
      return failed(again)
    }
  }
  if (ctx.translated) await unlinkTranslation(qc, id).catch(() => false)
  return {state: 'done'}
}

/** Who refers to it, named for the result list: the backlinks now, else the ids Barkpark gave. */
async function referrersNow(id: string, who: {id: string; type: string}[] | null): Promise<Referrer[]> {
  const now = (await readRefs({data: {id}}).catch(() => null)) as unknown as Backlink[] | null
  if (now?.length) return now
  return (who ?? []).filter((r) => r.type !== METADATA_TYPE).map((r) => ({from_doc_id: r.id.replace(/^drafts\./, ''), type: r.type, title: r.id, via_field: ''}))
}

async function duplicate(from: Doc, ctx: RowContext): Promise<RowResult> {
  await writeSlot()
  try {
    await mutate({data: {mutations: [{create: {_id: ctx.copyId, _type: from._type, ...withCopyNulls(ctx.initialValues, copyFields(from, ctx.rank(from)))} as unknown as Json}]}})
    return {state: 'done', copy: ctx.copyId}
  } catch (err) {
    const msg = (err as Error).message
    // The create landed before its answer was lost: the copy is there, under this row's id.
    if (/^mutate 409\b|already been taken/.test(msg) && (await readServerDoc(from._type, ctx.copyId).catch(() => null))) return {state: 'done', copy: ctx.copyId}
    return failed(err)
  }
}
