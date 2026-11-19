// The studio's PortableDoc pack, checked (docs/decisions/0009-pack-syncs-itself.md).
//   node scripts/pack-compare.mjs                     the pack against itself: as the sync wrote it
//   node scripts/pack-compare.mjs --against <barkpark> also against Barkpark's api/priv/portable_doc,
//                                                      by the source's own stamp: names each file that differs
// Exit 0: same. Exit 1: names what differs, one line each.
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {PACK_DIR, compare, readSourceNote, selfCheck, sourceDir, studioPack} from './lib/pack.mjs'

const {values} = parseArgs({options: {against: {type: 'string'}}})
const root = fileURLToPath(new URL('..', import.meta.url))
const errors = [...selfCheck(root), ...(values.against ? compare(root, sourceDir(values.against)) : [])]
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`${PACK_DIR}: ${Object.keys(studioPack(root)).length} files as synced from ${readSourceNote(root).commit.slice(0, 12)}${values.against ? ', same as Barkpark' : ''}`)
