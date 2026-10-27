import {test} from 'node:test'
import assert from 'node:assert/strict'
import {contentModelCredential} from './content-model-credential.ts'

test('account model reads never borrow the service identity, including after session loss', async () => {
  const service = async () => {throw new Error('shared credential must not be read')}
  assert.equal(await contentModelCredential('account', () => 'editor-session', service), 'editor-session')
  assert.equal(await contentModelCredential('account', () => '', service), '')
  assert.equal(await contentModelCredential('sso', () => 'editor-session', service), 'editor-session')
  await assert.rejects(contentModelCredential('account', () => {throw new Error('session unavailable')}, service), /session unavailable/)
})

test('explicit shared/dev lanes keep their existing guarded service-credential path', async () => {
  const editor = () => {throw new Error('not an account lane')}
  for (const mode of ['shared', 'dev']) {
    assert.equal(await contentModelCredential(mode, editor, async () => 'lane-service'), 'lane-service')
    await assert.rejects(contentModelCredential(mode, editor, async () => {throw new Error('no seat')}), /no seat/)
  }
})
