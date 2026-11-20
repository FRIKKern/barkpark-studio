import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'

// c1df slice 2: the e2e rig's resets, read from source. Unit job, no browser.
const journeys = new URL('../e2e/journeys/', import.meta.url)
const rig = new URL('../e2e/rig/', import.meta.url)
const files = (dir) => readdirSync(dir).filter((f) => /\.(ts|mjs)$/.test(f)).map((f) => ({name: f, src: readFileSync(new URL(f, dir), 'utf8')}))
const specs = files(journeys).filter((f) => f.name.endsWith('.spec.ts'))

// A seed file's media id is cached per worker (e2e/rig/seed-asset-cache.ts). A delete that
// does not go through deleteAsset leaves that id cached, and the next reset points the seed
// doc at an asset that is gone.
test('media is deleted only through deleteAsset (rig/seed-asset-cache.ts)', () => {
  const found = []
  for (const {name, src} of [...specs, ...files(rig).filter((f) => f.name !== 'seed-asset-cache.ts')]) {
    for (const m of src.matchAll(/method:\s*['"]DELETE['"]/g)) {
      const before = src.slice(Math.max(0, m.index - 240), m.index)
      if (/media/.test(before.slice(before.lastIndexOf('fetch(')))) found.push(`${name}:${src.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(found, [])
})

/** The docs each `Promise.all([...])` in a spec's afterEach resets, by value where the spec names it. */
export function resetGroups(src) {
  const consts = Object.fromEntries([...src.matchAll(/^const (\w+) = ['"`]([^'"`$]+)['"`]/gm)].map((m) => [m[1], m[2]]))
  const value = (arg) => {
    const a = arg.trim()
    return /^['"`]/.test(a) ? a.slice(1, -1) : (consts[a] ?? a)
  }
  const groups = []
  // From an opening bracket at `at` to its match (strings and comments are not told apart: specs' resets have none that matter).
  const close = (text, at) => {
    let depth = 0
    for (let i = at; i < text.length; i++) {
      if ('([{'.includes(text[i])) depth++
      if (')]}'.includes(text[i]) && --depth === 0) return i
    }
    return text.length - 1
  }
  for (const hook of src.matchAll(/test\.afterEach\(/g)) {
    const open = hook.index + 'test.afterEach'.length
    const body = src.slice(open, close(src, open) + 1)
    for (const all of body.matchAll(/Promise\.all\(/g)) {
      const at = all.index + 'Promise.all'.length
      const group = body.slice(all.index, close(body, at) + 1)
      const mapped = /\[([^\]]+)\]\.map\(\((\w+)\)\s*=>/.exec(group)
      const docs = []
      for (const call of group.matchAll(/\b(?:resetDoc|restore|deleteDoc|bpRemove|resetNative|discardDraft)\(\s*([^,)]+)/g)) {
        if (mapped && call[1].trim() === mapped[2]) docs.push(...mapped[1].split(',').map(value))
        else docs.push(value(call[1]))
      }
      groups.push(docs)
    }
  }
  return groups
}

// Calls in one Promise.all run at once: on one doc they would race (which write lands last
// decides what the next test reads). Same-doc calls stay in order, outside a group.
test("an afterEach's parallel resets name each doc once", () => {
  const twice = specs.flatMap(({name, src}) => resetGroups(src).filter((g) => new Set(g).size < g.length).map((g) => `${name}: ${g.join(', ')}`))
  assert.deepEqual(twice, [])
})

test('the reset scan reads groups, mapped lists and consts', () => {
  const src = "const A = 'post-1'\nconst B = 'post-2'\ntest.afterEach(async () => {\n  await Promise.all([t.resetDoc(A, 'post'), t.restore('post-1', {})])\n  await Promise.all([A, B].map((id) => t.resetDoc(id, 'post')))\n})\n"
  assert.deepEqual(resetGroups(src), [['post-1', 'post-1'], ['post-1', 'post-2']])
})
