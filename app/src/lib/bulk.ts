// B03: publish or unpublish several list rows at once, after Barkpark's LiveView Studio
// (studio_live/shared.ex `bulk_action/2`): one doc at a time, then one summary that
// counts what happened and, when the publish wall stopped one, says which rule.

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
