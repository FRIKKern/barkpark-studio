import type {QueryClient} from '@tanstack/react-query'
import type {Doc, Field, Schema} from './data'
import {advisoriesOf, flush, publish, reasonOf, unpublish, whenSaved} from './edits.ts'
import {isWall, type Outcome} from './bulk.ts'
import type {CustomRule} from './custom-rules.ts'
import type {Person} from './conditions.ts'
import {heldReason, publishErrors, refsToRead, type Ask, type Conditions} from './publish-check.ts'
import type {T} from './i18n'

// B03's Publish selected and Unpublish selected (components/BulkBar.tsx), one document at a
// time; one refusal never stops the rest. A publish asks first what the document's own Publish
// asks (lib/publish-check.ts), on the whole draft as it will go: its edits saved, then read in
// full (a list row may be a projection). A draft with an error is held back, named, with its
// first error, and no publish is sent for it. What can't be told is never a pass: a draft, or a
// document it refers to, that could not be read is held, "open it to check".

/** How a document is judged and named: what the bar knows (BulkBar). */
export type Judge = Omit<Ask, 'target'> & {
  conditions: Conditions
  schemaFor: (type: string) => Schema | undefined
  rulesFor: (type: string) => CustomRule[]
  nameOf: (doc: Doc, schema: Schema | undefined) => string
  /** The whole draft, read fresh: Barkpark's answer now (docQuery's `fresh`), never the list's row nor a shared read; null: not there. */
  readDoc: (type: string, id: string) => Promise<Doc | null>
  /** A document a reference field points at, read as the pane reads it (docQuery). */
  readRef: (field: Field, id: string) => Promise<Doc | null>
  /** The slugs in use among these drafts, one ask for all; it rejects when it can't tell. */
  slugsAmong: (docs: Doc[]) => Promise<Map<string, string[]>>
}

/** The draft as it will go: its edits saved, then read whole. Undefined: the read failed. */
async function fullDraft(qc: QueryClient, doc: Doc, judge: Judge): Promise<Doc | null | undefined> {
  const id = doc._publishedId
  flush(qc, id)
  await whenSaved(id)
  return judge.readDoc(doc._type, id).catch(() => undefined)
}

/** What holds this draft's Publish, said as a reason (its first error); null when nothing does. */
async function publishHold(doc: Doc, who: Person, judge: Judge, t: T): Promise<string | null> {
  const schema = judge.schemaFor(doc._type)
  if (!schema) return t('Its type could not be read: open it to check')
  // The pane's reads for its reference check (a strong reference must point at a published document).
  const refs = refsToRead(schema, doc)
  const targets = await Promise.all(refs.map((r) => judge.readRef(r.field, r.id))).catch(() => undefined)
  if (!targets) return t('A document it refers to could not be read: open it to check')
  const byId = new Map(refs.map((r, i) => [r.id, targets[i]]))
  const [first] = await publishErrors(doc, schema, who, judge.conditions, {...judge, target: (id) => byId.get(id), rules: judge.rulesFor(doc._type), findings: advisoriesOf(doc._publishedId)})
  return first ? heldReason(first) : null
}

/** How many times more a draft changed while it was checked is checked again, before it is held. */
const REJUDGES = 2

/**
 * The draft published only as judged (task-bc49c598e05b1fbf): `first`, as read before the slug
 * ask, is judged, then read again when its check is done. Changed meanwhile (another editor
 * while earlier drafts went, or during its own check), it is judged again, at most REJUDGES
 * times more, then held. A re-read that fails holds it, as a first read that fails does. An
 * unchanged draft costs two reads. The window left is the footer's own: the last read to the
 * publish (Barkpark's publish takes no revision yet, task-bda8661555dfd481).
 */
async function judgedNow(qc: QueryClient, row: Doc, first: Doc, who: Person, judge: Judge, t: T): Promise<{ready: Doc} | {outcome: Outcome}> {
  const name = (d: Doc | null | undefined) => judge.nameOf(d ?? row, judge.schemaFor(row._type))
  let now: Doc | null | undefined = first
  for (let round = 0; ; round++) {
    if (now === null || (now && !now._draft)) return {outcome: {kind: 'skipped'}}
    if (!now) return {outcome: {kind: 'held', doc: name(now), reason: t('It could not be read: open it to check')}}
    const held = await publishHold(now, who, judge, t)
    if (held) return {outcome: {kind: 'held', doc: name(now), reason: held}}
    const again = await fullDraft(qc, row, judge)
    if (again && again._draft && again._rev === now._rev) return {ready: again}
    if (again && again._draft && round === REJUDGES) return {outcome: {kind: 'held', doc: name(again), reason: t('It changed while it was checked: open it to check')}}
    now = again
  }
}

async function send(write: () => Promise<unknown>): Promise<Outcome> {
  try {
    await write()
    return {kind: 'done'}
  } catch (e) {
    const msg = (e as Error).message
    return {kind: isWall(msg) ? 'walled' : 'failed', reason: reasonOf(msg) ?? msg}
  }
}

/**
 * Each picked document in turn, for this person; `at` the progress. Publishing a doc with no
 * draft, or unpublishing one never published, is skipped.
 */
export async function runBulk(qc: QueryClient, action: 'publish' | 'unpublish', picked: Doc[], who: Person, {judge, at, t}: {judge: Judge; at: (i: number) => void; t: T}): Promise<Outcome[]> {
  const outcomes: Outcome[] = []
  if (action === 'unpublish') {
    for (const [i, doc] of picked.entries()) {
      at(i + 1)
      outcomes.push(doc._hasPublished === false ? {kind: 'skipped'} : await send(() => unpublish(qc, doc)))
    }
    return outcomes
  }
  const full = new Map<string, Doc | null | undefined>()
  for (const [i, doc] of picked.entries()) {
    at(i + 1)
    if (doc._draft) full.set(doc._publishedId, await fullDraft(qc, doc, judge))
  }
  // Slugs in use, asked once for all the drafts read. Can't tell: each publish asks its own, as the footer's does.
  const taken = await judge.slugsAmong([...full.values()].filter((d): d is Doc => !!d)).catch(() => null)
  for (const [i, row] of picked.entries()) {
    at(i + 1)
    const now = full.get(row._publishedId)
    const name = () => judge.nameOf(now ?? row, judge.schemaFor(row._type))
    // Nothing to publish: no draft in the list, or none (or no document) when read.
    if (!row._draft || now === null || (now && !now._draft)) {
      outcomes.push({kind: 'skipped'})
      continue
    }
    if (!now) {
      outcomes.push({kind: 'held', doc: name(), reason: t('It could not be read: open it to check')})
      continue
    }
    const slugs = taken?.get(now._publishedId)
    if (slugs) {
      outcomes.push({kind: 'failed', reason: `${slugs.join(', ')}: ${t('Slug is already in use')}`})
      continue
    }
    const judged = await judgedNow(qc, row, now, who, judge, t)
    if ('outcome' in judged) {
      outcomes.push(judged.outcome)
      continue
    }
    // The slugs were asked of the draft as first read: changed since, its publish asks its own.
    const same = judged.ready._rev === now._rev
    outcomes.push(await send(() => publish(qc, judged.ready, {slugsChecked: same && taken !== null})))
  }
  return outcomes
}
