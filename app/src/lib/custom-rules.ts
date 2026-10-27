import type {Doc, Field, Schema} from './data'
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

/** How a problem names its field, as a schema problem does: its title, the objects it sits in, its group. */
export type FieldInfo = {title: string; parents?: string[]; group?: string}

/**
 * The describer for `schema`: "seo.metaTitle" is Meta title in SEO, in SEO's group (Sanity's
 * "SEO / Meta title", its group tab marked). A document rule ("") has no title.
 */
export const describeField =
  (schema: Schema | undefined) =>
  (path: string): FieldInfo => {
    const names = path.split('.').filter(Boolean)
    if (!names.length) return {title: ''} // a document rule: its message alone, as Sanity lists it
    let fields: Field[] | undefined = schema?.fields
    const titles: string[] = []
    let group: string | undefined
    for (const [i, name] of names.entries()) {
      const f = fields?.find((x) => x.name === name)
      if (!f) return {title: name, ...(titles.length ? {parents: titles} : {}), ...(group ? {group} : {})}
      if (i === 0) group = f.group
      titles.push(f.title ?? f.name)
      fields = (f as {fields?: Field[]}).fields
    }
    const title = titles.pop()!
    return {title, ...(titles.length ? {parents: titles} : {}), ...(group ? {group} : {})}
  }

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
export function runCustomRules(rules: CustomRule[], doc: Doc, describe: (path: string) => FieldInfo, timeoutMs = RULE_TIMEOUT_MS): {now: Problem[]; later: Promise<Problem[]> | null} {
  const now: Problem[] = []
  const waits: Promise<Problem | null>[] = []
  const problem = (rule: CustomRule, message: string, level?: Level): Problem => ({path: rule.path ?? '', ...describe(rule.path ?? ''), message, level: level ?? rule.level ?? 'error'})
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

/** The rules' answers for one document: `id` the document, `key` the values they were run on. */
export type RulesState = {id: string; key: string; now: Problem[]; later: Problem[]; pending: boolean}

/**
 * A new run's state, as Sanity's: the answers that came at once replace the old ones, and the
 * last Promise answers stay on screen (same document) until this run's come, so an edit never
 * shows "No validation errors" mid-check. No Promise out, or another document: none kept.
 */
export const startRun = (s: RulesState, id: string, key: string, now: Problem[], pending: boolean): RulesState => ({id, key, now, later: pending && s.id === id ? s.later : [], pending})

/** What the panel shows: this document's latest answers, also while a newer run is out. */
export const visibleProblems = (s: RulesState, id: string): Problem[] => (s.id === id ? [...s.now, ...s.later] : [])
