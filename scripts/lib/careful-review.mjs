// The careful-review list in docs/decisions/0010: every file a keyed job runs, and every module that guards
// them. A change to a listed file gets a careful review before it merges. scripts/lib/careful-review.test.mjs
// holds the list to the repo both ways: a pinned file or guard missing from it is red, and so is a listed
// file that is gone, or neither pinned nor a guard.
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {dirname, join, normalize} from 'node:path'
import {fileURLToPath} from 'node:url'

import {PINS} from './workflow-keys.mjs'

export const DOC = 'docs/decisions/0010-deploy-key-one-helper.md'
const BULLET = '- **Careful review**'
/** The modules that check pins and key handling. A scripts/ module that imports a guard is a guard too. */
export const GUARD_ROOTS = ['scripts/lib/workflow-keys.mjs', 'scripts/lib/key-shims.mjs']

/** The paths the doc's careful-review bullet names, in backticks; a `folder/` holds the names after it. */
export function listed(doc) {
  const at = doc.indexOf(BULLET)
  if (at < 0) return []
  const bullet = doc.slice(at).split(/\n(?! )/)[0]
  let folder = ''
  const out = []
  for (const [, name] of bullet.matchAll(/`([^`]+)`/g)) {
    if (name.endsWith('/')) folder = name
    else out.push(folder + name)
  }
  return out
}

/** Every repo file a pinned job is: its workflow, the pins themselves, and each file it runs. */
export const pinned = (pins) => [PINS, ...pins.jobs.flatMap((p) => [`.github/workflows/${p.job.split(' ')[0]}`, ...Object.keys(p.runs)])]

/** The guards among `sources` (path → text): the roots, then each module importing a guard, until none is added. */
export function guards(sources) {
  const found = new Set(GUARD_ROOTS)
  const imports = Object.fromEntries(Object.entries(sources).map(([path, text]) => [path,
    [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map(([, rel]) => normalize(join(dirname(path), rel)))]))
  for (let grew = true; grew; ) {
    grew = false
    for (const [path, deps] of Object.entries(imports)) if (!found.has(path) && deps.some((d) => found.has(d))) found.add(path), (grew = true)
  }
  return [...found]
}

/** What is wrong with the list: a pinned file or guard missing from it, or a listed file gone or neither. */
export function carefulGaps({list, pinnedFiles, guardFiles, exists}) {
  const want = new Set([...pinnedFiles, ...guardFiles])
  const out = []
  for (const p of [...want].sort()) if (!list.includes(p)) out.push(`${p}: ${pinnedFiles.includes(p) ? 'pinned' : 'a guard'}, but not on the careful-review list in ${DOC}`)
  for (const p of list) {
    if (!exists(p)) out.push(`${p}: on the careful-review list, but gone`)
    else if (!want.has(p)) out.push(`${p}: on the careful-review list, but neither pinned nor a guard`)
  }
  return out
}

const root = fileURLToPath(new URL('../..', import.meta.url))
const walk = (dir) => readdirSync(join(root, dir), {withFileTypes: true}).flatMap((e) =>
  e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(`${dir}/${e.name}`)) : /\.[cm]?[jt]s$/.test(e.name) ? [`${dir}/${e.name}`] : [])
/** The list, the pinned files and the guards, as the repo holds them. */
export function repoCareful() {
  const read = (p) => readFileSync(join(root, p), 'utf8')
  return {
    list: listed(read(DOC)),
    pinnedFiles: pinned(JSON.parse(read(PINS))),
    guardFiles: guards(Object.fromEntries(walk('scripts').map((p) => [p, read(p)]))),
    exists: (p) => existsSync(join(root, p)),
  }
}
