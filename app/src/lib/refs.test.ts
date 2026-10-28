import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readDocOf, refOpenType, refTarget} from './refs.ts'

// A made-up dataset: a reference field to author or guest, and an id only guest holds.
type Doc = {_id: string; _type: string; name: string}
const docs: Doc[] = [
  {_id: 'g1', _type: 'guest', name: 'Ada Example'},
  {_id: 'a1', _type: 'author', name: 'Bo Sample'},
]
function store() {
  const reads: string[] = []
  return {
    reads,
    io: {
      typeOf: async (id: string) => (reads.push(`typeOf ${id}`), docs.find((d) => d._id === id)?._type),
      read: async (type: string, id: string) => (reads.push(`${type} ${id}`), docs.find((d) => d._id === id && d._type === type) ?? null),
    },
  }
}

test('a reference preview loads its doc when the first to type does not hold it', async () => {
  const {reads, io} = store()
  const doc = await readDocOf(['author', 'guest'], 'g1', io)
  assert.equal(doc?.name, 'Ada Example')
  // One read names the type, one reads the doc as it: never as the first type.
  assert.deepEqual(reads, ['typeOf g1', 'guest g1'])
  // The row opens the doc as its own type.
  assert.equal(refOpenType(['author', 'guest'], doc), 'guest')
  // Read as the first type alone, the row has nothing to show: what kept it at "…".
  assert.equal(await readDocOf(['author'], 'g1', store().io), null)
})

test('a reference preview of the first to type, of one type, and of a type not listed', async () => {
  assert.equal((await readDocOf(['author', 'guest'], 'a1', store().io))?.name, 'Bo Sample')
  const one = store()
  assert.equal((await readDocOf(['author'], 'a1', one.io))?.name, 'Bo Sample')
  assert.deepEqual(one.reads, ['author a1'])
  // Held by a type the field does not list, or by none: no doc.
  assert.equal(await readDocOf(['author', 'post'], 'g1', store().io), null)
  assert.equal(await readDocOf(['author', 'guest'], 'missing', store().io), null)
  assert.equal(await readDocOf([], 'a1', store().io), null)
  // Before the doc loads, and for a doc of a type not listed, the row opens as the first type.
  assert.equal(refOpenType(['author', 'guest'], undefined), 'author')
  assert.equal(refOpenType(['author', 'guest'], {_type: 'post'}), 'author')
})

test('a reference row to an id no document holds shows the unavailable mark, not … forever', async () => {
  // The read has not answered: the row shows "…".
  assert.equal(refTarget(undefined), 'loading')
  // Read as any of its types, an id no document holds answers null: Sanity's unavailable mark.
  const gone = await readDocOf(['author', 'guest'], 'nobody-holds-this', store().io)
  assert.equal(gone, null)
  assert.equal(refTarget(gone), 'missing')
  // Held by a type the reference does not list: missing too, as Sanity marks it.
  assert.equal(refTarget(await readDocOf(['author', 'post'], 'g1', store().io)), 'missing')
  // Found, the row shows the document.
  assert.equal(refTarget(await readDocOf(['author', 'guest'], 'g1', store().io)), 'found')
})
