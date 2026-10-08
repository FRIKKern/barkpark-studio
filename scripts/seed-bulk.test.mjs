import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'

const script = new URL('./seed-bulk.mjs', import.meta.url).href
function run(datasets = {}) {
  const source = `
    const paths = []
    globalThis.fetch = async (url) => {
      paths.push(new URL(url).pathname)
      return {ok: true, status: 200, json: async () => ({})}
    }
    process.on('exit', () => console.log('PATHS:' + JSON.stringify(paths)))
    await import(${JSON.stringify(script)})
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8',
    env: {...process.env, BARKPARK_URL: 'https://example.invalid', BARKPARK_WORKSPACE: 'test',
      BARKPARK_PROJECT: 'default', BARKPARK_TOKEN: 'test', SANITY_TOKEN: 'test',
      BARKPARK_DATASET: undefined, SANITY_STUDIO_DATASET: undefined, ...datasets},
  })
  return {...result, paths: JSON.parse(result.stdout.match(/PATHS:(.*)/)?.[1] ?? 'null')}
}

test('bulk fixtures default both targets to e2e-local', () => {
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.paths.length, 61)
  assert.ok(result.paths.every(path => path.endsWith('/e2e-local')))
})

test('bulk fixtures honor separate isolated datasets', () => {
  const result = run({BARKPARK_DATASET: 'e2e-local-bp', SANITY_STUDIO_DATASET: 'e2e-local-reference'})
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.paths.filter(path => path.endsWith('/e2e-local-reference')).length, 20)
  assert.equal(result.paths.filter(path => path.endsWith('/e2e-local-bp')).length, 41)
})

for (const variable of ['BARKPARK_DATASET', 'SANITY_STUDIO_DATASET']) {
  test(`refuse ${variable}=production before any request`, () => {
    const result = run({[variable]: 'production'})
    assert.equal(result.status, 1)
    assert.match(result.stderr, /require an e2e-local dataset/)
    assert.deepEqual(result.paths, [])
  })
}
