// B03: publish or unpublish several list rows at once, after Barkpark's LiveView Studio
// (studio_live/shared.ex `bulk_action/2`): one doc at a time, then one summary that
// counts what happened and, when the publish wall stopped one, says which rule.

import {METADATA_TYPE} from './translation-group.ts'

/** LiveView's cap: a selection never grows past this. */
export const MAX_SELECTED = 500

export type Outcome = {kind: 'done'} | {kind: 'skipped'} | {kind: 'walled'; reason: string} | {kind: 'failed'; reason: string}

/** The wall's refusals (label spine, unknown tag, near-duplicate) are not plain failures. */
export const isWall = (message: string) => /"code":"(label_spine|unknown_tag|duplicate_of)"/.test(message)

type Translate = (en: string, vars?: Record<string, string | number>) => string
/** English, filled in: the default when no translation is passed (unit tests). */
const english: Translate = (en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : en)

/**
 * "Published 3 of 4. 1 blocked by the publish wall — …" (LiveView's words), plus what
 * was left alone. `t`: the Studio's translate (B01); this file stays importable by node's tests.
 */
export function bulkSummary(action: 'publish' | 'unpublish', outcomes: Outcome[], t: Translate = english): {tone: 'positive' | 'critical'; title: string; description?: string} {
  const n = (k: Outcome['kind']) => outcomes.filter((o) => o.kind === k).length
  const [done, skipped, walled, failed] = [n('done'), n('skipped'), n('walled'), n('failed')]
  const title = action === 'publish' ? t('Published {done} of {total}', {done, total: outcomes.length}) : t('Unpublished {done} of {total}', {done, total: outcomes.length})
  const wall = outcomes.find((o): o is Extract<Outcome, {kind: 'walled'}> => o.kind === 'walled')
  const fail = outcomes.find((o): o is Extract<Outcome, {kind: 'failed'}> => o.kind === 'failed')
  const parts = [
    skipped ? (action === 'publish' ? t('{n} had no changes to publish.', {n: skipped}) : skipped === 1 ? t('{n} was not published.', {n: skipped}) : t('{n} were not published.', {n: skipped})) : '',
    walled ? t('{n} blocked by the publish wall — {reason}', {n: walled, reason: wall!.reason}) : '',
    failed ? t('{n} failed: {reason}', {n: failed, reason: fail!.reason}) : '',
  ].filter(Boolean)
  return {tone: walled || failed ? 'critical' : 'positive', title, description: parts.join(' ') || undefined}
}

// ── Delete, duplicate and discard several rows (task-22ce73ad72423b85) ────────────────
// Beyond LiveView's bar: each runs one row at a time through the single document's own
// action (components/BulkDialog.tsx). This part decides, per row, whether it may go: once
// for the confirm (from the list and its "used in" lookups), and again right before the row
// runs, from a fresh read, since another editor may publish, delete or refer to it meanwhile.

export type BulkAction = 'delete' | 'duplicate' | 'discard'
/** A ticked row as far as a bulk action cares: which versions it has. */
export type BulkRow = {id: string; type: string; draft: boolean; published: boolean}
/** A document that refers to a row (Barkpark's backlinks, lib/data.ts Backlink). */
export type Referrer = {from_doc_id: string; type: string; title: string; via_field: string}
/**
 * Why a row is left alone: other documents refer to it (a delete would leave them pointing
 * at nothing; Barkpark refuses it too), its "used in" could not be read (never read as
 * "nobody"), the role may not, nothing to discard, never published (a discard would delete
 * it), gone already, or the editor stopped the run before it.
 */
export type Hold = 'referenced' | 'unchecked' | 'role' | 'no-changes' | 'never-published' | 'gone' | 'stopped'
export type Step = {row: BulkRow; go: true} | {row: BulkRow; go: false; why: Hold; refs?: Referrer[]}
export type Perms = {canWrite: boolean; canPublish: boolean}

/**
 * One row's verdict. `row` null: it is gone. `refs` undefined: not known (the lookup is
 * still running or failed), which holds a delete back. A Contributor deletes drafts only
 * (deleting a published document unpublishes it), as the document footer's Delete.
 */
export function planRow(action: BulkAction, row: BulkRow | null, refs: Referrer[] | undefined, {canWrite, canPublish}: Perms, id = row?.id ?? ''): Step {
  const stay = (why: Hold, r?: Referrer[]): Step => ({row: row ?? {id, type: '', draft: false, published: false}, go: false, why, ...(r && {refs: r})})
  if (!row) return stay('gone')
  if (!canWrite) return stay('role')
  if (action === 'duplicate') return {row, go: true}
  if (action === 'discard') return !row.draft ? stay('no-changes') : !row.published ? stay('never-published') : {row, go: true}
  if (row.published && !canPublish) return stay('role')
  if (!refs) return stay('unchecked')
  return refs.length ? stay('referenced', refs) : {row, go: true}
}

/** The confirm's plan: every ticked row, in the list's order, and whether it goes. */
export const planBulk = (action: BulkAction, rows: BulkRow[], perms: Perms, refsOf: (id: string) => Referrer[] | undefined = () => undefined): Step[] =>
  rows.map((row) => planRow(action, row, action === 'delete' ? refsOf(row.id) : [], perms))

/** A row's state in the run: what the result list shows, and what a retry runs again. */
export type RowResult = {state: 'waiting'} | {state: 'running'} | {state: 'done'; copy?: string} | {state: 'skipped'; why: Hold; refs?: Referrer[]} | {state: 'failed'; reason: string}

/** The rows a retry runs: those that failed or were stopped before their turn. Done or held rows never go twice. */
export const retryIds = (results: Map<string, RowResult>): string[] =>
  [...results].filter(([, r]) => r.state === 'failed' || (r.state === 'skipped' && r.why === 'stopped')).map(([id]) => id)

/**
 * Who Barkpark named when it refused a delete as referenced (409 `document_referenced`,
 * `details.referrers`); null when the answer can't be read (cut short, or another error).
 */
export function refusedReferrers(message: string): {id: string; type: string}[] | null {
  try {
    const body = JSON.parse(message.slice(message.indexOf('{'))) as {error?: {code?: string; details?: {referrers?: {id: string; type: string}[]}}}
    return body.error?.code === 'document_referenced' && Array.isArray(body.error.details?.referrers) ? body.error.details.referrers : null
  } catch {
    return null
  }
}

/** Only the row's translation group refers to it: unlinking it lets the delete through (lib/translations.ts). */
export const onlyGroupLink = (referrers: {type: string}[] | null): boolean => !!referrers?.length && referrers.every((r) => r.type === METADATA_TYPE)

/** "Deleted 3 of 5. 1 left alone: …. 1 failed: …" for the toast after a run. */
export function bulkResultSummary(action: BulkAction, results: RowResult[], t: Translate = english): {tone: 'positive' | 'critical' | 'caution'; title: string; description?: string} {
  const done = results.filter((r) => r.state === 'done').length
  const held = results.filter((r) => r.state === 'skipped').length
  const failed = results.filter((r) => r.state === 'failed').length
  const total = results.length
  const title = action === 'delete' ? t('Deleted {done} of {total}', {done, total}) : action === 'duplicate' ? t('Duplicated {done} of {total}', {done, total}) : t('Discarded changes in {done} of {total}', {done, total})
  const parts = [held ? t('{n} left alone.', {n: held}) : '', failed ? t('{n} failed.', {n: failed}) : ''].filter(Boolean)
  return {tone: failed ? 'critical' : held ? 'caution' : 'positive', title, description: parts.join(' ') || undefined}
}
