// A job that checks out with a key (`ssh-key`, or a `token` from secrets) keeps it on the runner for every
// later step, so those steps run no project code: no node/pnpm/npm/sh scripts, nothing from the checkout,
// only GitHub's own actions. Read from the workflow text, in this repo's layout (steps as `- ` items under
// `steps:`). scripts/lib/workflow-keys.test.mjs runs it over .github/workflows/.

const CODE = /(^|[\s;&|(`])(node|pnpm|npm|npx|yarn|bun|deno|python3?|ruby|perl|make|bash|sh|source|\.)(\s|$)|(^|[\s;&|(`])\.{0,2}\/[\w.-]|\bscripts\//m

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

const keyed = (step) => /uses:\s*actions\/checkout@/.test(step) && /\b(ssh-key|token):\s*'?\$\{\{\s*secrets\./.test(step) && !/persist-credentials:\s*false/.test(step)

/** Steps that run project code after a keyed checkout in the same job: `job: step` lines. */
export function codeAfterKey(text) {
  const out = []
  for (const [job, steps] of Object.entries(jobSteps(text))) {
    let key = false
    for (const step of steps) {
      if (key) {
        const uses = step.match(/uses:\s*(\S+)/)?.[1]
        const run = step.match(/run:\s*\|?\s*\n?([\s\S]*)/)?.[1]
        if ((uses && !uses.startsWith('actions/')) || (run && CODE.test(run))) out.push(`${job}: ${step.split('\n')[0].trim()}`)
      }
      if (keyed(step)) key = true
    }
  }
  return out
}
