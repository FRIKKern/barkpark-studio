// A job that checks out with a key (`ssh-key`, or a `token` from secrets, in any quotes) keeps it on the
// runner for every later step. So every later step is held to an allow-list: `uses:` only GitHub's own
// checkout and artifact actions, and `run:` only the commands in ALLOWED (git, gh, jq, sleep and shell
// built-ins that run no other program). Anything else is named, and so is shell this reader cannot follow
// (backticks, heredocs, eval-like built-ins). Read from the workflow text, in this repo's layout (steps as
// `- ` items under `steps:`). scripts/lib/sync-plan.test.mjs runs it over .github/workflows/.

export const ALLOWED = new Set(['git', 'gh', 'jq', 'sleep', 'set', 'echo', 'printf', 'read', 'test', '[', '[[', 'exit', 'true', 'false', ':', 'break', 'continue'])
const USES = /^actions\/(checkout|download-artifact|upload-artifact)@/
// Words that open or close a compound command: the next word is a command again.
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'esac'])
// Words whose arguments up to the next separator are not commands.
const HEADS = new Set(['for', 'case', 'select'])

/** Each job's steps as text, `{job: [step text]}`. */
export function jobSteps(text) {
  const jobs = {}
  let job
  let steps
  let indent
  for (const line of text.split('\n')) {
    const j = line.match(/^ {2}([\w-]+):\s*$/)
    if (j && /^jobs:/m.test(text.slice(0, text.indexOf(line)))) {
      job = jobs[j[1]] = []
      steps = false
      continue
    }
    if (!job) continue
    if (/^\s+steps:\s*$/.test(line)) {
      steps = true
      indent = undefined
      continue
    }
    if (!steps || /^\s*#/.test(line)) continue
    const item = line.match(/^(\s*)- /)
    if (item && (indent === undefined || item[1].length === indent)) {
      indent = item[1].length
      job.push(line.slice(indent + 2))
    } else if (job.length && (line.trim() === '' || line.search(/\S/) > indent)) job[job.length - 1] += `\n${line}`
    else if (line.trim()) steps = false
  }
  return jobs
}

/** A step's `run:` script: a `|` or `>` block (its lines, dedented) or the one-line value. */
export function runOf(step) {
  const lines = step.split('\n')
  const at = lines.findIndex((l) => /^\s*run:/.test(l))
  if (at < 0) return undefined
  const key = lines[at].search(/\S/)
  const value = lines[at].replace(/^\s*run:\s*/, '')
  if (!/^[|>][-+]?\s*$/.test(value)) return value.replace(/^(['"])(.*)\1$/, '$2')
  const body = []
  for (const l of lines.slice(at + 1)) {
    if (l.trim() && l.search(/\S/) <= key) break
    body.push(l)
  }
  const pad = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)))
  return body.map((l) => l.slice(pad)).join('\n')
}

/**
 * The commands a shell script runs, as far as this reader follows shell: each simple command's first
 * word (after `NAME=value` assignments), in `$( )` and `<( )` too, quotes and `$(( ))` skipped.
 * Shell it cannot follow comes back as a `!`-prefixed entry, so the caller refuses it.
 */
export function commands(src) {
  const out = []
  let i = 0
  let start = true // the next word is a command
  let skip = false // words up to the next separator are not commands (for/case heads)
  const sep = () => ((start = true), (skip = false))
  const word = () => {
    let w = ''
    while (i < src.length && !/[\s;&|()<>`]/.test(src[i])) {
      const c = src[i]
      if (c === "'") {
        const end = src.indexOf("'", i + 1)
        w += src.slice(i, end + 1)
        i = end + 1
      } else if (c === '"') dq(), (w += '""')
      else if (c === '$' && src.startsWith('$((', i)) arith(), (w += '$')
      else if (c === '$' && src[i + 1] === '(') (i += 2), sub(), (w += '$')
      else if (c === '\\') (w += src.slice(i, i + 2)), (i += 2)
      else (w += c), i++
    }
    return w
  }
  // Inside double quotes only $( ) runs anything.
  const dq = () => {
    i++
    while (i < src.length && src[i] !== '"') {
      if (src[i] === '\\') i += 2
      else if (src.startsWith('$((', i)) arith()
      else if (src.startsWith('$(', i)) (i += 2), sub()
      else if (src[i] === '`') out.push('!backtick'), i++
      else i++
    }
    i++
  }
  const arith = () => {
    let depth = 0
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')' && --depth === 0) return void i++
    }
  }
  // A command substitution: its own commands, up to its closing parenthesis.
  const sub = () => {
    const keep = [start, skip]
    sep()
    scan(true)
    ;[start, skip] = keep
  }
  const scan = (inner) => {
    while (i < src.length) {
      const c = src[i]
      if (c === '\n' || c === ';') (i++, sep())
      else if (c === ' ' || c === '\t') i++
      else if (c === '#' && (i === 0 || /\s/.test(src[i - 1]))) while (i < src.length && src[i] !== '\n') i++
      else if (c === '&' || c === '|') (i++, sep())
      else if (c === '(') (i++, sep())
      else if (c === ')') {
        i++
        if (inner) return
        sep()
      } else if (c === '`') (out.push('!backtick'), i++)
      else if (c === '<' || c === '>') {
        if (src.startsWith('<<', i) && !src.startsWith('<<<', i)) out.push('!heredoc')
        if (src.startsWith('<(', i)) (i += 2, sub())
        else {
          while (src[i] === '<' || src[i] === '>' || src[i] === '&') i++
          while (src[i] === ' ') i++
          if (/[\d-]/.test(src[i] ?? '')) while (/[\d-]/.test(src[i] ?? '')) i++
          else word() // the redirection's target
        }
      } else {
        const w = word()
        if (!w) {
          i++
          continue
        }
        // A case pattern (`close)`, `*)`): a word right before an unopened `)`.
        if (!inner && src[i] === ')') {
          i++
          sep()
          continue
        }
        if (skip || !start) continue
        if (/^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/.test(w)) continue // an assignment: the command, if any, follows
        if (RESERVED.has(w)) continue
        if (HEADS.has(w)) {
          skip = true
          continue
        }
        if (w === 'in') continue
        out.push(w)
        start = false
        // A [[ ]] test: its && || ( ) are its own, not separators; only $( ) inside runs anything.
        if (w === '[[')
          while (i < src.length) {
            if (/[\s&|()<>]/.test(src[i])) i++
            else if (word() === ']]') break
          }
      }
    }
  }
  scan(false)
  return out
}

const keyed = (step) => /uses:\s*actions\/checkout@/.test(step) && /\b(ssh-key|token):\s*['"]?\$\{\{\s*secrets\./.test(step) && !/persist-credentials:\s*(['"]?)false\1/.test(step)

/** Every step after a keyed checkout that goes past the allow-list: `job: step: what` lines. */
export function codeAfterKey(text) {
  const out = []
  for (const [job, steps] of Object.entries(jobSteps(text))) {
    let key = false
    for (const step of steps) {
      if (key) {
        const name = step.split('\n')[0].trim()
        const uses = step.match(/uses:\s*['"]?([^\s'"]+)/)?.[1]
        if (uses && !USES.test(uses)) out.push(`${job}: ${name}: uses ${uses}`)
        const run = runOf(step)
        if (run !== undefined) for (const c of new Set(commands(run))) if (!ALLOWED.has(c)) out.push(`${job}: ${name}: ${c}`)
      }
      if (keyed(step)) key = true
    }
  }
  return out
}
