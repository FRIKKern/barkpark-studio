import type {Doc} from './data'
import type {Level, Problem} from './validation'
import {getPath} from './paths.ts'

// Sanity's Rule.custom, from the studio config (StudioConfig.document.validation): a function
// of a field's value, or of the whole document, with its context (`document`, `parent`). It
// may answer at once or with a Promise. These rules run in the studio only, as Sanity's custom
// rules do: an API write or an import is not checked by them (Barkpark checks only the
// schema's data rules: required, min, max, pattern, unique).

/** What a custom rule sees: the document as edited, the object holding the field, its path. */
export type RuleContext = {document: Doc; parent: unknown; path: string}
/** true (or nothing): fine. A string: the problem's message. */
export type RuleAnswer = true | string | undefined | void
/** `path`: a field ("excerpt", "seo.metaTitle"); none: a document-level rule. `level`: error unless said. */
export type CustomRule = {path?: string; level?: Level; validate: (value: unknown, ctx: RuleContext) => RuleAnswer | Promise<RuleAnswer>}

/** A rule's Promise that never settles must not hold Publish: it fails after this long. */
export const RULE_TIMEOUT_MS = 10_000

/** `p`, or a rejection with "Validation timed out" after `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, message = 'Validation timed out'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    )
  })
}

/** Only the latest run counts: an answer for document values since edited is dropped. */
export function latestOnly() {
  let latest = 0
  return {next: () => ++latest, current: (run: number) => run === latest}
}

const parentPath = (path: string) => path.replace(/(\.[^.]+|\[[^\]]+\])$/, '')

/**
 * Every rule against `doc`: the answers that came at once (`now`), and the ones that came as a
 * Promise (`later`, null when none did). A rule that throws or rejects is an error carrying its
 * message, as Sanity shows one; it never takes the pane down.
 */
export function runCustomRules(rules: CustomRule[], doc: Doc, titleOf: (path: string) => string, timeoutMs = RULE_TIMEOUT_MS): {now: Problem[]; later: Promise<Problem[]> | null} {
  const now: Problem[] = []
  const waits: Promise<Problem | null>[] = []
  const problem = (rule: CustomRule, message: string, level?: Level): Problem => ({path: rule.path ?? '', title: titleOf(rule.path ?? ''), message, level: level ?? rule.level ?? 'error'})
  const read = (rule: CustomRule, answer: RuleAnswer) => (typeof answer === 'string' ? problem(rule, answer) : null)
  const failed = (rule: CustomRule, e: unknown) => problem(rule, e instanceof Error ? e.message : String(e), 'error')
  for (const rule of rules) {
    const path = rule.path ?? ''
    const ctx: RuleContext = {document: doc, parent: path && path.includes('.') ? getPath(doc, parentPath(path)) : doc, path}
    let answer: RuleAnswer | Promise<RuleAnswer>
    try {
      answer = rule.validate(path ? getPath(doc, path) : doc, ctx)
    } catch (e) {
      now.push(failed(rule, e))
      continue
    }
    if (answer && typeof (answer as Promise<RuleAnswer>).then === 'function')
      waits.push(withTimeout(Promise.resolve(answer as Promise<RuleAnswer>), timeoutMs).then((a) => read(rule, a), (e) => failed(rule, e)))
    else {
      const p = read(rule, answer as RuleAnswer)
      if (p) now.push(p)
    }
  }
  return {now, later: waits.length ? Promise.all(waits).then((ps) => ps.filter((p): p is Problem => !!p)) : null}
}
