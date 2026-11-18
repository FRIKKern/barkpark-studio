import {test} from 'node:test'
import assert from 'node:assert/strict'
import {approveBody, invited, inviteEmail, knownRoles, mayChangeTo, ownRequest, refusal, rolesOffered, seatRule, singleFlight, type Seat} from './members-admin.ts'

const seat = (role: string, identity = `${role}@example.com`): Seat => ({principal_type: 'user', principal_id: `id-${identity}`, role, identity})
const t = (en: string, vars: Record<string, string | number> = {}) => en.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]))

test('J69 members: only an owner is offered the owner role; nobody else is offered any', () => {
  assert.deepEqual(rolesOffered('owner'), ['owner', 'admin', 'member', 'contributor'])
  assert.deepEqual(rolesOffered('admin'), ['admin', 'member', 'contributor'])
  for (const role of ['member', 'contributor', null, 'viewer']) assert.deepEqual(rolesOffered(role), [])
  // A custom role the workspace uses is offered too, after the built-ins.
  assert.deepEqual(rolesOffered('admin', knownRoles(['member', 'reviewer', ''])), ['admin', 'member', 'contributor', 'reviewer'])
  // An admin's picker on a member's seat holds no owner; on an owner's seat there is nothing to pick.
  assert.ok(!seatRule(seat('member'), 'admin', 2).roles.includes('owner'))
  assert.deepEqual(seatRule(seat('owner'), 'admin', 2), {roles: ['owner'], change: false, remove: false, why: 'owner_only'})
  assert.equal(mayChangeTo(seat('member'), 'owner', 'admin', 2), false)
  assert.equal(mayChangeTo(seat('member'), 'owner', 'owner', 2), true)
})

test('J69 members: the last owner can be neither demoted nor removed; with two owners either can', () => {
  const last = seatRule(seat('owner'), 'owner', 1)
  assert.deepEqual(last, {roles: ['owner'], change: false, remove: false, why: 'last_owner'})
  assert.equal(mayChangeTo(seat('owner'), 'admin', 'owner', 1), false)
  const two = seatRule(seat('owner'), 'owner', 2)
  assert.equal(two.change && two.remove, true)
  assert.equal(mayChangeTo(seat('owner'), 'admin', 'owner', 2), true)
  // A member's seat stays changeable however few owners there are; the same role is no change.
  assert.equal(mayChangeTo(seat('member'), 'member', 'owner', 1), false)
  // A non-admin can change nothing.
  assert.deepEqual(seatRule(seat('member'), 'member', 1), {roles: ['member'], change: false, remove: false})
})

test('J69 members: approve sends the picked role (member by default), never one above the approver', () => {
  assert.deepEqual(approveBody(undefined, 'admin'), {role: 'member'})
  assert.deepEqual(approveBody('contributor', 'admin'), {role: 'contributor'})
  assert.deepEqual(approveBody('owner', 'owner'), {role: 'owner'})
  assert.equal(approveBody('owner', 'admin'), null)
  assert.equal(approveBody('member', 'member'), null)
  assert.equal(approveBody('superuser', 'owner'), null)
  // An admin's own request (a seated editor can't have one) is never theirs to approve.
  assert.equal(ownRequest({id: 'r1', email: ' Ada@Example.com'}, 'ada@example.com'), true)
  assert.equal(ownRequest({id: 'r1', email: 'ben@example.com'}, 'ada@example.com'), false)
})

test('J69 members: one click is one request while the first is out', () => {
  const once = singleFlight()
  assert.equal(once.start('approve:r1'), true)
  assert.equal(once.start('approve:r1'), false)
  assert.equal(once.start('deny:r1'), true)
  once.end('approve:r1')
  assert.equal(once.start('approve:r1'), true)
})

test("J69 members: each refusal is said in words, Barkpark's codes first", () => {
  assert.match(refusal(403, 'owner_required', 'only an owner…', t), /Only an owner/)
  assert.match(refusal(403, 'forbidden', 'token lacks required permission', t), /not Owner or Administrator/)
  assert.match(refusal(409, 'already_member', '', t), /already has a seat/)
  assert.match(refusal(409, 'last_owner', '', t), /last owner/)
  assert.match(refusal(404, 'not_found', 'no pending access request with that id here', t), /another admin may have handled it/)
  assert.match(refusal(422, 'unprocessable', 'email must be a valid address', t), /email address/)
  assert.match(refusal(422, 'unprocessable', 'role is not a role of this workspace', t), /role does not exist/)
  assert.match(refusal(401, 'session_lost', '', t), /logged out/)
  assert.match(refusal(502, undefined, undefined, t), /\(502\)/)
  assert.match(invited(202, {}, 'a@b.no', t), /invited/)
  assert.match(invited(201, {reclaimed: true}, 'a@b.no', t), /reset/)
  assert.equal(inviteEmail(' ada@example.com '), 'ada@example.com')
  for (const bad of ['ada', 'ada@', '@example.com', 'a b@c.no', 'ada@example']) assert.equal(inviteEmail(bad), null)
})
