import type {QueryClient} from '@tanstack/react-query'
import type {Doc, Schema} from './data'
import {advisoriesOf, flush, publish, reasonOf, unpublish, whenSaved} from './edits.ts'
import {isWall, type Outcome} from './bulk.ts'
import type {CustomRule} from './custom-rules.ts'
import type {Person} from './conditions.ts'
import {heldReason, publishErrors, type Ask, type Conditions} from './publish-check.ts'
import type {T} from './i18n'

// B03's Publish selected and Unpublish selected (components/BulkBar.tsx), one document at a
// time; one refusal never stops the rest. A publish asks first what the document's own Publish
// asks (lib/publish-check.ts), on the draft as it will go (its edits saved): a draft with an
// error is held back, named, with its first error, and no publish is sent for it.

/** How a document is judged and named: what the bar knows (BulkBar). */
export type Judge = Omit<Ask, 'target'> & {
  conditions: Conditions
  schemaFor: (type: string) => Schema | undefined
  rulesFor: (type: string) => CustomRule[]
  nameOf: (doc: Doc, schema: Schema | undefined) => string
}

/** The first error that holds this draft's Publish, said as a reason; null when none does. */
async function publishHold(qc: QueryClient, doc: Doc, who: Person, judge: Judge): Promise<string | null> {
  const id = doc._publishedId
  flush(qc, id)
  await whenSaved(id)
  const now = qc.getQueryData<Doc>(['doc', id]) ?? doc
  const schema = judge.schemaFor(now._type)
  if (!schema) return null
  // A referenced document is judged as far as it is known here (the pane reads its own).
  const target = (ref: string) => qc.getQueryData<Doc | null>(['doc', ref])
  const [first] = await publishErrors(now, schema, who, judge.conditions, {...judge, target, rules: judge.rulesFor(now._type), findings: advisoriesOf(id)})
  return first ? heldReason(first) : null
}

/**
 * Each picked document in turn, for this person: `taken` the slugs in use (asked once for all of them), `at` the
 * progress. Publishing a doc with no draft, or unpublishing one never published, is skipped.
 */
export async function runBulk(qc: QueryClient, action: 'publish' | 'unpublish', picked: Doc[], who: Person, {taken, judge, at, t}: {taken: Map<string, string[]>; judge: Judge; at: (i: number) => void; t: T}): Promise<Outcome[]> {
  const outcomes: Outcome[] = []
  for (const [i, doc] of picked.entries()) {
    at(i + 1)
    if (action === 'publish' ? !doc._draft : doc._hasPublished === false) {
      outcomes.push({kind: 'skipped'})
      continue
    }
    const slugs = action === 'publish' && taken.get(doc._publishedId)
    if (slugs) {
      outcomes.push({kind: 'failed', reason: `${slugs.join(', ')}: ${t('Slug is already in use')}`})
      continue
    }
    const held = action === 'publish' ? await publishHold(qc, doc, who, judge) : null
    if (held) {
      outcomes.push({kind: 'held', doc: judge.nameOf(doc, judge.schemaFor(doc._type)), reason: held})
      continue
    }
    try {
      await (action === 'publish' ? publish(qc, doc, {slugsChecked: true}) : unpublish(qc, doc))
      outcomes.push({kind: 'done'})
    } catch (e) {
      const msg = (e as Error).message
      outcomes.push({kind: isWall(msg) ? 'walled' : 'failed', reason: reasonOf(msg) ?? msg})
    }
  }
  return outcomes
}
