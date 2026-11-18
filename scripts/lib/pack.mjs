// The studio's copy of Barkpark's PortableDoc pack (conformance/pack/), and how it is checked
// against its source: FRIKKern/barkpark main, api/priv/portable_doc. Barkpark is the source;
// conformance/pack/ is written only by scripts/pack-sync.mjs (docs/decisions/0009-pack-syncs-itself.md).
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'

export const SOURCE_REPO = 'FRIKKern/barkpark'
export const SOURCE_PATH = 'api/priv/portable_doc'
export const PACK_DIR = 'conformance/pack'
/** Copied as they are, studio path ← source path (under SOURCE_PATH). The block goldens come by the stamp. */
export const COPIED = {
  'conformance.mjs': 'conformance/conformance.mjs',
  'conformance.d.mts': 'conformance/conformance.d.mts',
  'goldens/stamp.json': 'goldens/stamp.json',
}
const BLOCKS = 'goldens/blocks'

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const hashOf = (path) => sha256(readFileSync(path))
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const goldenFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.golden.json')).sort() : [])

/** A Barkpark checkout (or an archive of SOURCE_PATH) → the pack directory inside it. */
export const sourceDir = (checkout) => join(checkout, SOURCE_PATH)

/**
 * The source as the studio would hold it, `{files: {studio path: sha256}, errors}`. Every file the
 * source stamp names is checked against it, and every block golden must be named there: a source
 * that disagrees with its own stamp is refused, nothing taken from it.
 */
export function sourcePack(src) {
  const errors = []
  const stampPath = join(src, 'goldens/stamp.json')
  if (!existsSync(stampPath)) return {files: {}, errors: [`${stampPath}: no stamp, not a PortableDoc pack`]}
  const stamp = readJson(stampPath).files ?? {}
  for (const [file, hash] of Object.entries(stamp)) {
    const path = join(src, 'goldens', file)
    if (!existsSync(path)) errors.push(`source goldens/${file}: named in its stamp, absent`)
    else if (hashOf(path) !== hash) errors.push(`source goldens/${file}: differs from its stamp`)
  }
  const blocks = goldenFiles(join(src, BLOCKS))
  for (const f of blocks) if (!(`blocks/${f}` in stamp)) errors.push(`source ${BLOCKS}/${f}: not in its stamp`)
  if (blocks.length === 0) errors.push(`source ${BLOCKS}: no block goldens`)
  const files = {}
  for (const f of blocks) files[`${BLOCKS}/${f}`] = stamp[`blocks/${f}`]
  for (const [mine, theirs] of Object.entries(COPIED)) {
    const path = join(src, theirs)
    if (existsSync(path)) files[mine] = hashOf(path)
    else errors.push(`source ${theirs}: absent`)
  }
  return {files, errors}
}

/** What the studio holds: every file under conformance/pack/ but SOURCE.md, `{studio path: sha256}`. */
export function studioPack(root) {
  const files = {}
  const walk = (rel) => {
    for (const d of readdirSync(join(root, PACK_DIR, rel), {withFileTypes: true})) {
      const f = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) walk(f)
      else if (f !== 'SOURCE.md') files[f] = hashOf(join(root, PACK_DIR, f))
    }
  }
  walk('')
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)))
}

/** Files by name: in `theirs` only (added), in both but not the same (changed), in `mine` only (removed). */
export function diff(mine, theirs) {
  const names = (o) => Object.keys(o).sort()
  return {
    added: names(theirs).filter((f) => !(f in mine)),
    changed: names(theirs).filter((f) => f in mine && mine[f] !== theirs[f]),
    removed: names(mine).filter((f) => !(f in theirs)),
  }
}

/** The studio pack against the source: one line per file that differs, or the source's own errors. */
export function compare(root, src) {
  const source = sourcePack(src)
  if (source.errors.length) return source.errors
  const d = diff(studioPack(root), source.files)
  return ['added', 'changed', 'removed'].flatMap((kind) => d[kind].map((f) => `${PACK_DIR}/${f}: ${kind} in Barkpark`))
}

/**
 * A new pack's conformance report against the committed one: the rows that moved. None, and the
 * sync may write the report with the new pack's stamp; any, and the report stays as it is, so
 * conformance fails in the sync PR (the studio renderer is behind Barkpark). A type the studio does
 * not render (`missing`) may come, stay or go: the studio never claimed it.
 */
export function rowsMoved(committed, report) {
  const moved = []
  for (const key of ['renderer', 'compare']) if (committed[key] !== report[key]) moved.push(`${key}: committed ${committed[key]}, now ${report[key]}`)
  const before = new Map(committed.rows.map((r) => [r.type, r]))
  const now = new Map(report.rows.map((r) => [r.type, r]))
  for (const type of [...new Set([...before.keys(), ...now.keys()])].sort()) {
    const a = before.get(type)
    const b = now.get(type)
    if ((a?.status ?? 'missing') === 'missing' && (b?.status ?? 'missing') === 'missing') continue
    if (JSON.stringify(a) !== JSON.stringify(b)) moved.push(`row ${type}: committed ${JSON.stringify(a) ?? 'absent'}, now ${JSON.stringify(b) ?? 'absent'}`)
  }
  return moved
}

/** SOURCE.md as pack-sync writes it: the commit, and the sha256 of every file the stamp does not cover. */
export function sourceNote(commit, files) {
  const rows = Object.keys(COPIED).map((f) => `| \`${f}\` | \`${files[f]}\` |`)
  return `# PortableDoc conformance pack

Written by \`scripts/pack-sync.mjs\` from \`${SOURCE_REPO}\` commit \`${commit}\`, path \`${SOURCE_PATH}\`.
Never edit it by hand: Barkpark is the source, and an hourly job (\`.github/workflows/sync-pack.yml\`)
brings it here (docs/decisions/0009-pack-syncs-itself.md).

| File | sha256 |
|---|---|
${rows.join('\n')}

The block goldens are named, with their sha256, in \`goldens/stamp.json\`.
`
}

export function readSourceNote(root) {
  const path = join(root, PACK_DIR, 'SOURCE.md')
  if (!existsSync(path)) return {commit: undefined, files: {}}
  const text = readFileSync(path, 'utf8')
  const files = {}
  for (const [, f, hash] of text.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)) files[f] = hash
  return {commit: text.match(/commit `([0-9a-f]{40})`/)?.[1], files}
}

/**
 * The studio pack against itself, no source needed (runs in every PR's conformance step): each
 * block golden as its stamp names it, no more and no fewer, and every other file as SOURCE.md
 * records it. A hand edit anywhere in conformance/pack/ fails here.
 */
export function selfCheck(root) {
  const errors = []
  const held = studioPack(root)
  const note = readSourceNote(root)
  if (!note.commit) errors.push(`${PACK_DIR}/SOURCE.md: no source commit`)
  const stamp = held['goldens/stamp.json'] ? readJson(join(root, PACK_DIR, 'goldens/stamp.json')).files ?? {} : {}
  const expected = {}
  for (const [f, hash] of Object.entries(stamp)) if (f.startsWith('blocks/')) expected[`goldens/${f}`] = hash
  for (const f of Object.keys(COPIED)) expected[f] = note.files[f]
  const d = diff(held, expected)
  for (const f of d.added) errors.push(`${PACK_DIR}/${f}: named by the pack, absent`)
  for (const f of d.changed) errors.push(`${PACK_DIR}/${f}: not as the sync wrote it`)
  for (const f of d.removed) errors.push(`${PACK_DIR}/${f}: not named by the stamp or SOURCE.md`)
  return errors
}
