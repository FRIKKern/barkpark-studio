// B03: publish or unpublish several list rows at once, after Barkpark's LiveView Studio
// (studio_live/shared.ex `bulk_action/2`): one doc at a time, then one summary that
// counts what happened and, when the publish wall stopped one, says which rule.

/** LiveView's cap: a selection never grows past this. */
export const MAX_SELECTED = 500

export type Outcome = {kind: 'done'} | {kind: 'skipped'} | {kind: 'walled'; reason: string} | {kind: 'failed'; reason: string}

/** The wall's refusals (label spine, unknown tag, near-duplicate) are not plain failures. */
export const isWall = (message: string) => /"code":"(label_spine|unknown_tag|duplicate_of)"/.test(message)

/** "Published 3 of 4. 1 blocked by the publish wall — …" (LiveView's words), plus what was left alone. */
export function bulkSummary(action: 'publish' | 'unpublish', outcomes: Outcome[]): {tone: 'positive' | 'critical'; title: string; description?: string} {
  const n = (k: Outcome['kind']) => outcomes.filter((o) => o.kind === k).length
  const verb = action === 'publish' ? 'Published' : 'Unpublished'
  const [done, skipped, walled, failed] = [n('done'), n('skipped'), n('walled'), n('failed')]
  const title = `${verb} ${done} of ${outcomes.length}`
  const wall = outcomes.find((o): o is Extract<Outcome, {kind: 'walled'}> => o.kind === 'walled')
  const fail = outcomes.find((o): o is Extract<Outcome, {kind: 'failed'}> => o.kind === 'failed')
  const parts = [
    skipped ? `${skipped} ${action === 'publish' ? 'had no changes to publish' : skipped === 1 ? 'was not published' : 'were not published'}.` : '',
    walled ? `${walled} blocked by the publish wall — ${wall!.reason}` : '',
    failed ? `${failed} failed: ${fail!.reason}` : '',
  ].filter(Boolean)
  return {tone: walled || failed ? 'critical' : 'positive', title, description: parts.join(' ') || undefined}
}
