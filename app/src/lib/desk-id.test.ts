import assert from 'node:assert/strict'
import {test} from 'node:test'
import {deskId, servesDesk, structurePath} from './desk-id.ts'

test('STUDIO_DESK_ID: unset is deskStructure; a published id passes; a draft or a path stops the server', () => {
  assert.equal(deskId(undefined), 'deskStructure')
  assert.equal(deskId(' '), 'deskStructure')
  assert.equal(deskId('deskStructure.pensum'), 'deskStructure.pensum')
  for (const bad of ['drafts.deskStructure', '../deskStructure', 'desk structure', 'desk?x=1', '.hidden']) assert.throws(() => deskId(bad), /STUDIO_DESK_ID/)
})

test('STUDIO_DESK_ID: the default desk reads the plain tree; another must be named back', () => {
  assert.equal(structurePath('production', 'deskStructure'), '/v1/structure/production')
  assert.equal(structurePath('production', 'deskStructure.pensum'), '/v1/structure/production?desk=deskStructure.pensum')
  assert.equal(servesDesk('deskStructure', {}), true)
  assert.equal(servesDesk('deskStructure.pensum', {}), false) // a Barkpark without ?desk= answers the default tree
  assert.equal(servesDesk('deskStructure.pensum', {desk: 'deskStructure.pensum'}), true)
})
