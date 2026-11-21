import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
// Barkpark's own answers are in fixtures/fixed-document-cases.json, made by running Barkpark's
// FixedDocuments.answer/4 (scripts/fixed-document-cases.exs). The studio must never offer a
// write Barkpark refuses, and may hide one it allows only where the case names a task for it.
import {fixedList, offers, type FixedAction} from './fixed-documents.ts'
import {plainReason} from './plain-reason.ts'
import {offersNew} from './creatable.ts'

type Case = {name: string; fixed: string[] | null; action: FixedAction | 'edit'; id: string; exists: boolean; server: 'ok' | 'refused'; gap?: string}
const {cases} = JSON.parse(readFileSync(new URL('../../../fixtures/fixed-document-cases.json', import.meta.url), 'utf8')) as {cases: Case[]}

// An edit is offered on every document the studio opens; the rule is about new ones and deletes.
const studio = (c: Case) => c.action === 'edit' || offers(fixedList(c.fixed), c.action, c.id)

test("the studio offers a write on a fixed type only where Barkpark allows it (fixtures/fixed-document-cases.json)", () => {
  assert.equal(cases.length, 24)
  for (const c of cases) {
    if (studio(c)) assert.equal(c.server, 'ok', `${c.name}: the studio offers what Barkpark refuses`)
    // Hidden though Barkpark allows it: only the known gap, with its task.
    else assert.equal(c.server === 'ok', !!c.gap, `${c.name}: hidden ${c.server === 'ok' ? 'with no task for it' : ''}`)
  }
  assert.deepEqual(cases.filter((c) => c.gap).map((c) => c.name), ['listed: create side-om-oss, which does not exist yet'])
})

test('no list or a malformed one is no rule; a list of ids is', () => {
  assert.equal(fixedList(undefined), undefined)
  assert.equal(fixedList(null), undefined)
  assert.equal(fixedList('side-om-oss'), undefined)
  assert.equal(fixedList([1]), undefined)
  assert.deepEqual(fixedList([]), [])
  assert.equal(offers(undefined, 'duplicate', 'x'), true)
  assert.equal(offers([], 'create', 'x'), false)
})

test("the + menus ask the same rule: no list offers a new one, [] and a list offer none", () => {
  for (const fixedDocuments of [undefined, [], ['side-om-oss']]) assert.equal(offersNew({fixedDocuments}), offers(fixedList(fixedDocuments), 'create', ''), JSON.stringify(fixedDocuments))
  assert.equal(offersNew({}), true)
  assert.equal(offersNew({fixedDocuments: []}), false)
})

test("Barkpark's refusal reads in the editor's words, naming the type", () => {
  const nb = (en: string, vars?: Record<string, string | number>) => `nb:${en.replace('{type}', String(vars?.type))}`
  assert.equal(plainReason('fixed_document', undefined, {action: 'create', type: 'side'}), 'side has a fixed set of documents. A new one cannot be created.')
  assert.equal(plainReason('fixed_document', undefined, {action: 'delete', type: 'side'}), 'This document is one of the fixed documents of side, so it cannot be deleted.')
  assert.match(plainReason('fixed_document', nb, {action: 'delete', type: 'side'}) ?? '', /^nb:.*side/)
})
