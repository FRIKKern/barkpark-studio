// ci-lease (node --test): a create that answered 200 but was overwritten by a racing create
// is not ours (two shards both took ci-6, run 38917974630); one left alone is.
import assert from 'node:assert/strict'
import {test} from 'node:test'

Object.assign(process.env, {BARKPARK_URL: 'http://barkpark.test', BARKPARK_WORKSPACE: 'w', BARKPARK_PROJECT: 'default', BARKPARK_TOKEN: 't', CI_LEASE_CONFIRM_MS: '0'})
const {acquire} = await import('./ci-lease.mjs')

// A fake ci-locks: creates always answer 200 (as Barkpark's race does); `overwrite` names
// the datasets whose lease another shard's create lands on right after ours.
function fakeLocks(overwrite) {
  const docs = new Map()
  let rev = 0
  globalThis.fetch = async (url, init = {}) => {
    const json = (body) => new Response(JSON.stringify(body), {status: 200})
    if (url.includes('/query/')) return json({result: {documents: []}})
    if (url.includes('/doc/')) {
      const d = docs.get(url.split('/drafts.lease-')[1])
      return d ? json({result: d}) : new Response('{}', {status: 404})
    }
    const {create} = JSON.parse(init.body).mutations[0]
    const dataset = create._id.replace('lease-', '')
    const mine = {...create, _rev: `r${++rev}`}
    docs.set(dataset, overwrite.includes(dataset) ? {...create, holder: 'another shard', _rev: `r${++rev}`} : mine)
    return json({results: [{document: mine}]})
  }
}

test('a lease another create landed over is not ours: the next dataset is taken', async () => {
  fakeLocks(['ci'])
  assert.equal(await acquire({prefer: 'ci', holder: 'me'}), 'ci-2')
})

test('a lease left alone is ours', async () => {
  fakeLocks([])
  assert.equal(await acquire({prefer: 'ci', holder: 'me'}), 'ci')
})
