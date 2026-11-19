// Every job in .github/workflows is one of two kinds, read from the parsed YAML (js-yaml; comments are
// not data). It "holds no key" when every checkout has `persist-credentials: false`, its token may write
// nothing, and it reads no secret but the data-only ones below. Every other job is keyed: it is pinned,
// whole, in scripts/lib/keyed-jobs.json, with the sha256 of its YAML (and the workflow's own keys, which
// it inherits) and of each repo file it runs. Changing a keyed job, or a file it runs, changes its pin in
// the same PR. scripts/lib/keyed-jobs.test.mjs holds the repo to it; `node scripts/lib/workflow-keys.mjs
// --pin` rewrites the hashes of the jobs already listed.
import {createHash} from 'node:crypto'
import {readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const yaml = createRequire(new URL('../../app/package.json', import.meta.url))('js-yaml')

/** Secrets that give no write to this repo, each with why. */
export const DATA_SECRETS = {
  BARKPARK_TOKEN: 'reads and writes the studio-parity workspace on Barkpark; no write to this repo',
}
export const PINS = 'scripts/lib/keyed-jobs.json'

const sha256 = (text) => createHash('sha256').update(text).digest('hex')
/**
 * JSON with every object's keys sorted: the same YAML, however written, gives the same text. Anything but
 * a plain object, array, string, finite number, boolean or null is refused, by its path.
 */
export function canonical(v, at = '') {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v)
  if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map((x, i) => canonical(x, `${at}[${i}]`)).join(',')}]`
  if (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v)))
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k], `${at}.${k}`)}`).join(',')}}`
  throw new Error(`${at || 'the value'} is ${typeof v === 'number' ? v : 'not a plain value'}, which this reader refuses`)
}
/** YAML as GitHub reads it: the core schema (no dates, no `<<` merge). */
export const load = (text) => yaml.load(text, {schema: yaml.CORE_SCHEMA})

/** Why a job does not hold "no key" (empty: it holds none). */
export function keyReasons(workflow, job) {
  const why = []
  if (!job || typeof job !== 'object' || Array.isArray(job)) return ['not a job this reader knows']
  if ('uses' in job) why.push(`calls ${job.uses}`)
  const steps = job.steps ?? []
  if (!Array.isArray(steps)) why.push('steps is not a list')
  else
    for (const [i, step] of steps.entries()) {
      if (!step || typeof step !== 'object' || Array.isArray(step)) why.push(`step ${i + 1} is not a mapping`)
      else if (/^actions\/checkout@/i.test(String(step.uses ?? '')) && step.with?.['persist-credentials'] !== false)
        why.push(`step ${i + 1} checks out without persist-credentials: false`)
    }
  const permissions = 'permissions' in job ? job.permissions : workflow.permissions
  if (writes(permissions)) why.push(`its token may write (permissions: ${JSON.stringify(permissions ?? 'the repo default')})`)
  let text
  try {
    text = canonical({job, env: workflow.env ?? null, defaults: workflow.defaults ?? null})
  } catch (e) {
    return [...why, e.message]
  }
  for (const name of secrets(text)) if (!(name in DATA_SECRETS)) why.push(`reads secret ${name}`)
  return why
}
const LEVELS = new Set(['read', 'none'])
function writes(p) {
  if (p === 'read-all' || (p && typeof p === 'object' && !Array.isArray(p) && Object.values(p).every((v) => LEVELS.has(v)))) return false
  return true // write, write-all, unset (the repo default) or anything else
}
/**
 * The secret names read by `${{ }}` expressions in this canonical JSON, keys and values alike: from each
 * `${{` to the end of its JSON string, so a `}}` inside a quoted string hides nothing. One written in a way
 * not read here is `?`.
 */
function secrets(text) {
  const names = new Set()
  for (let i = text.indexOf('${{'); i >= 0; i = text.indexOf('${{', i + 3)) {
    let end = i
    while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
    for (const m of text.slice(i, end).matchAll(/secrets/gi)) {
      const rest = text.slice(i, end).slice(m.index + m[0].length)
      const name = rest.match(/^\s*\.\s*([A-Za-z_][\w-]*)/)?.[1] ?? rest.match(/^\s*\[\s*'([^']*)'\s*\]/)?.[1]
      names.add(name ? name.toUpperCase() : '?')
    }
  }
  return names
}
/** In a keyed job every action, and a called workflow, is named by a full commit SHA. */
const unpinnedUses = (job) => [job.uses, ...(Array.isArray(job.steps) ? job.steps.map((s) => s?.uses) : [])].filter((u) => u !== undefined && !/^[^@\s]+@[0-9a-f]{40}$/.test(String(u)))

/** A keyed job's pin: its YAML with the workflow's own keys (all but `jobs`), as canonical JSON. */
export function jobHash(workflow, name) {
  const {jobs, ...own} = workflow
  return sha256(canonical({workflow: own, job: jobs[name]}))
}

/**
 * Every problem: a workflow this reader cannot parse, a keyed job not pinned, a pin that no longer
 * matches its job or a file it runs, a pin for a job that holds no key or is gone. `files` maps workflow
 * file names to their text; `read(path)` gives a repo file's bytes.
 */
export function keyProblems(files, pins, read) {
  const out = []
  const pinned = new Map(pins.jobs.map((p) => [p.job, p]))
  const seen = new Set()
  for (const [file, text] of Object.entries(files)) {
    let workflow
    try {
      workflow = load(text)
    } catch (e) {
      out.push(`${file}: not parsed (${e.reason ?? e.message})`)
      continue
    }
    if (!workflow?.jobs || typeof workflow.jobs !== 'object') {
      out.push(`${file}: no jobs this reader knows`)
      continue
    }
    for (const name of Object.keys(workflow.jobs)) {
      const id = `${file} ${name}`
      const why = keyReasons(workflow, workflow.jobs[name])
      const pin = pinned.get(id)
      seen.add(id)
      if (!why.length) {
        if (pin) out.push(`${id}: holds no key; drop its pin`)
        continue
      }
      if (!pin) {
        out.push(`${id}: holds a key (${why.join('; ')}) and is not pinned in ${PINS}`)
        continue
      }
      for (const u of unpinnedUses(workflow.jobs[name])) out.push(`${id}: uses ${u}, not a full commit SHA`)
      let hash
      try {
        hash = jobHash(workflow, name)
      } catch (e) {
        out.push(`${id}: ${e.message}`)
        continue
      }
      if (hash !== pin.sha256) out.push(`${id}: changed since its pin (now ${hash})`)
      for (const [path, want] of Object.entries(pin.runs)) {
        let bytes
        try {
          bytes = read(path)
        } catch {
          out.push(`${id}: runs ${path}, which is gone`)
          continue
        }
        if (sha256(bytes) !== want) out.push(`${id}: ${path} changed since its pin (now ${sha256(bytes)})`)
      }
    }
  }
  for (const id of pinned.keys()) if (!seen.has(id)) out.push(`${id}: pinned, but no such job`)
  return out
}

const root = fileURLToPath(new URL('../..', import.meta.url))
/** The repo's own workflows, its pins and its files. */
export const repo = () => {
  const dir = join(root, '.github/workflows')
  const files = Object.fromEntries(readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]))
  return {files, pins: JSON.parse(readFileSync(join(root, PINS), 'utf8')), read: (path) => readFileSync(join(root, path))}
}

// --pin: rewrite the hashes of the jobs already listed (adding a job, or a file it runs, is by hand).
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--pin') {
  const {files, pins, read} = repo()
  for (const pin of pins.jobs) {
    const [file, name] = pin.job.split(' ')
    pin.sha256 = jobHash(load(files[file]), name)
    for (const path of Object.keys(pin.runs)) pin.runs[path] = sha256(read(path))
  }
  writeFileSync(join(root, PINS), `${JSON.stringify(pins, null, 2)}\n`)
}
