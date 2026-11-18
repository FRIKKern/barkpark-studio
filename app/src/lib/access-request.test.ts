import {test} from 'node:test'
import assert from 'node:assert/strict'
import {NOTE_MAX, noteToSend, pollEvery, POLL_MS, refusal, screenFor, type OwnRequest} from './access-request.ts'
import nb from '../i18n/nb/access.ts'

// task-cc6a6d85be054b17: each Barkpark answer maps to the request-access screen and its words.
const row = (over: Partial<OwnRequest> = {}): OwnRequest => ({id: 'r1', workspace: 'acme', status: 'pending', note: null, inserted_at: '2026-11-18T10:00:00Z', decided_at: null, ...over})
const ok = (requests: OwnRequest[], invitations: {id: string; workspace: string; role: string}[] = []) => ({kind: 'ok' as const, requests, invitations})

test('no request yet: the form; a 202 pending row: pending with its date and note, polled', () => {
  assert.deepEqual(screenFor(ok([])), {view: 'form'})
  const pending = screenFor(ok([row({note: 'Hi'})]))
  assert.deepEqual(pending, {view: 'pending', id: 'r1', sentAt: '2026-11-18T10:00:00Z', note: 'Hi'})
  assert.equal(pollEvery(pending), POLL_MS)
  assert.equal(pollEvery({view: 'form'}), false)
})

test('the newest request decides; a decline offers asking again; an approval lets in once', () => {
  const older = row({id: 'old', status: 'pending', inserted_at: '2026-11-01T00:00:00Z'})
  const denied = row({id: 'd', status: 'denied', inserted_at: '2026-11-17T00:00:00Z', decided_at: '2026-11-17T09:00:00Z'})
  assert.deepEqual(screenFor(ok([older, denied])), {view: 'denied', decidedAt: '2026-11-17T09:00:00Z'})
  assert.deepEqual(screenFor(ok([denied]), {askAgain: true}), {view: 'form', again: 'denied'})
  const approved = row({id: 'a', status: 'approved'})
  assert.deepEqual(screenFor(ok([approved])), {view: 'approved', id: 'a'})
  // Let in once and still here: the seat has gone since, so the form again.
  assert.deepEqual(screenFor(ok([approved]), {entered: new Set(['a'])}), {view: 'form', again: 'removed'})
})

test('a pending invitation comes before the form; this sign-in cannot ask: the old words', () => {
  assert.equal(screenFor(ok([row()], [{id: 'i1', workspace: 'acme', role: 'member'}])).view, 'invited')
  assert.deepEqual(screenFor({kind: 'unavailable'}), {view: 'unavailable'})
  assert.deepEqual(screenFor({kind: 'error', answer: {status: 0}}), {view: 'failed'})
  assert.deepEqual(screenFor(undefined), {view: 'loading'})
})

test('each refusal has its words and its next step', () => {
  assert.deepEqual(refusal('ask', {status: 409, code: 'already_member'}), {then: 'refresh_me', words: {en: 'You already have access to this workspace. Opening it…'}})
  assert.deepEqual(refusal('ask', {status: 403, code: 'email_unconfirmed'}).words, {en: 'Confirm your email address before asking for access.'})
  assert.deepEqual(refusal('ask', {status: 409, code: 'too_many_pending', message: 'you have 20 pending requests; withdraw one first'}).words.vars, {count: 20})
  assert.deepEqual(refusal('ask', {status: 429, code: 'rate_limited', retryAfter: 720}).words, {en: "You've reached the limit for access requests. Try again in {minutes} min.", vars: {minutes: 12}})
  assert.equal(refusal('ask', {status: 429}).words.vars?.minutes, 12, 'no Retry-After: the hour shared by five asks')
  assert.deepEqual(refusal('ask', {status: 422, code: 'unprocessable', message: `note must be text of at most ${NOTE_MAX} characters`}).words, {en: 'The message can be at most {max} characters.', vars: {max: 500}})
  assert.equal(refusal('ask', {status: 422, code: 'unprocessable', message: 'workspace must be a workspace slug'}).words.en, "Access can't be requested at this address.")
  assert.deepEqual(refusal('ask', {status: 0}), {then: 'stay', words: {en: 'There was a problem submitting your request. Please try again.'}})
  assert.equal(refusal('ask', {status: 401}).then, 'refresh_me')
  assert.deepEqual(refusal('withdraw', {status: 404, code: 'not_found'}), {then: 'refetch', words: {en: 'This request was already decided or withdrawn.'}})
  assert.equal(refusal('accept', {status: 404}).then, 'refetch')
  assert.equal(refusal('accept', {status: 422}).then, 'stay')
  assert.equal(refusal('decline', {status: 500}).words.en, 'The invitation could not be answered. Try again.')
})

test('every refusal has its nb-NO words', () => {
  const answers = [{status: 401}, {status: 409, code: 'already_member'}, {status: 403, code: 'email_unconfirmed'}, {status: 409, code: 'too_many_pending'}, {status: 429}, {status: 422, message: 'note'}, {status: 422}, {status: 404}, {status: 0}]
  for (const action of ['ask', 'withdraw', 'accept', 'decline', 'load'] as const)
    for (const a of answers) {
      const {en} = refusal(action, a).words
      assert.ok(nb[en], `nb-NO for "${en}"`)
    }
})

test('the note goes trimmed, and an empty one not at all', () => {
  assert.equal(noteToSend('  hello \n'), 'hello')
  assert.equal(noteToSend('   '), undefined)
})
