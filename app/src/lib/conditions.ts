import type {Field} from './data'
import {segments} from './paths.ts'

// Conditional fields (J30). Barkpark's schema says when a field shows with
// `visibleWhen: {field, operator, value}` (api content/field_visibility.ex); these are
// the same operators with the same meaning, so the Studio and Barkpark's own
// validation never disagree. `readOnly` is `true` or the same condition shape:
// Barkpark stores it but has no editor rule for it yet (task-00eac0b023b11517).
// Like Sanity's hidden/readOnly, both are editor behaviour, not access control.
/**
 * `scope` (barkpark#22554, Sanity's `({parent}) => …`): "document" (the default) reads
 * `field` from the document root; "parent" from the object or array item the field sits in.
 */
export type Condition = {field: string; operator: string; value?: unknown; scope?: 'document' | 'parent'}

// Dotted path from the document root; a list on the way fans out over its rows.
function lookup(doc: unknown, path: string[]): unknown {
  if (!path.length) return doc
  if (Array.isArray(doc)) return doc.flatMap((row) => lookup(row, path) as unknown[])
  if (doc && typeof doc === 'object') return lookup((doc as Record<string, unknown>)[path[0]!], path.slice(1))
  return undefined
}

const count = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : v == null || v === '' ? 0 : 1)
const isEmpty = (v: unknown) => count(v) === 0

export function matches(c: Condition, doc: Record<string, unknown>): boolean {
  const v = lookup(doc, c.field.split('.'))
  switch (c.operator) {
    case 'eq':
      return v === c.value
    case 'neq':
      return v !== c.value
    case 'in':
      return Array.isArray(c.value) && c.value.includes(v)
    case 'empty':
      return isEmpty(v)
    case 'non_empty':
      return !isEmpty(v)
    case 'starts_with':
      return typeof v === 'string' && typeof c.value === 'string' && v.startsWith(c.value)
    case 'count_eq':
      return count(v) === c.value
    case 'count_neq':
      return count(v) !== c.value
    case 'count_gt':
      return count(v) > Number(c.value)
    case 'count_lt':
      return count(v) < Number(c.value)
    default:
      return true // an operator we don't know never hides a field
  }
}

/** What a condition reads from: the enclosing object for scope "parent" (the document when there is none). */
const base = (c: Condition, doc: Record<string, unknown>, parent?: Record<string, unknown>) => (c.scope === 'parent' && parent ? parent : doc)
/** The schema's `hidden: true` (Barkpark's, Sanity's): never in the form, whatever the document; its value kept (a manual order's orderRank). */
export const alwaysHidden = (f: Field) => f.hidden === true
/** The schema's `readOnly: true`, whatever the document. */
export const alwaysReadOnly = (f: Field) => f.readOnly === true
const readOnlyWhen = (f: Field) => (typeof f.readOnly === 'object' && f.readOnly !== null ? f.readOnly : undefined)
export const isHidden = (f: Field, doc: Record<string, unknown>, parent?: Record<string, unknown>) => alwaysHidden(f) || (!!f.visibleWhen && !matches(f.visibleWhen, base(f.visibleWhen, doc, parent)))
export const isReadOnly = (f: Field, doc: Record<string, unknown>, parent?: Record<string, unknown>) => {
  const when = readOnlyWhen(f)
  return alwaysReadOnly(f) || (!!when && matches(when, base(when, doc, parent)))
}

/** Sanity shows a group's tab only while some field in it shows (`visibleGroups`): one whose fields are all hidden has none. */
export const groupShows = (fields: Field[], group: string, doc: Record<string, unknown>, hidden = (f: Field) => isHidden(f, doc)) => fields.some((f) => f.group === group && !hidden(f))

// Sanity's hidden and readOnly callbacks: `({currentUser, document, parent, value, path}) => boolean`.
// Barkpark's schemas are JSON, so the callbacks live in the studio config, `form.conditions`
// keyed `type.path` (lib/plugins.ts). A form convenience, as Sanity's: Barkpark's roles decide writes.

/** Sanity's CurrentUser: who is signed in, their role here under Sanity's role names. */
export type CurrentUser = {id: string; name: string; email: string; roles: {name: string; title: string}[]}
/** The person a field is judged for: a CurrentUser; null with nobody signed in (shared sign-in); undefined until Barkpark has said who. */
export type Person = CurrentUser | null | undefined
/** Sanity's Path: field names and array items by `_key`. */
export type PathSegment = string | {_key: string}
export type ConditionContext = {currentUser: CurrentUser | null; document: Record<string, unknown>; parent: unknown; value: unknown; path: PathSegment[]}
/** Sanity's ConditionalProperty. */
export type ConditionalProperty = boolean | ((context: ConditionContext) => boolean) | undefined
export type FieldConditions = {hidden?: ConditionalProperty; readOnly?: ConditionalProperty}

const ROLE_TITLES: Record<string, string> = {administrator: 'Administrator', editor: 'Editor', contributor: 'Contributor', viewer: 'Viewer'}

/**
 * A Barkpark seat's role under Sanity's name: owner and admin are `administrator`, member
 * `editor`, contributor `contributor`; a seat that may not write is `viewer`, as the studio
 * calls it (J49). Any other role keeps its own name.
 */
export function sanityRole(role: string | null | undefined, canWrite = true): string | null {
  if (!canWrite) return 'viewer'
  if (!role) return null
  return role === 'owner' || role === 'admin' ? 'administrator' : role === 'member' ? 'editor' : role
}

type Me = {email: string | null; name: string | null; userId: string | null; role: string | null; canWrite: boolean; provisional?: boolean}
/** whoAmI as Sanity's currentUser: null with nobody signed in (shared sign-in); undefined while Barkpark has not said who (not read yet, or a provisional stand-in). */
export function currentUserOf(me: Me | undefined): Person {
  if (!me || me.provisional) return undefined
  if (!me.email) return null
  const role = sanityRole(me.role, me.canWrite)
  return {id: me.userId ?? '', name: me.name ?? me.email, email: me.email, roles: role ? [{name: role, title: ROLE_TITLES[role] ?? role}] : []}
}

/** The config key of a field path: its type, then field names with array items left out (`post.links.title`). */
export const conditionKey = (type: string, path: string) => `${type}.${segments(path).flatMap((s) => ('name' in s ? [s.name] : [])).join('.')}`
/**
 * Whether fieldState for the field at `path` depends on the document or the person (a
 * condition in the schema, or a config callback for `type.path`): the form reads the whole
 * document only for those, and draws the rest by alwaysHidden and alwaysReadOnly.
 */
export const dependsOnDoc = (type: string, f: Field, path: string, rules: Record<string, FieldConditions> | undefined) => !!rules?.[conditionKey(type, path)] || !!f.visibleWhen || !!readOnlyWhen(f)
export const sanityPath = (path: string): PathSegment[] => segments(path).map((s) => ('name' in s ? s.name : {_key: s.key}))

const told = new Set<string>()
const tell = (msg: string) => told.has(msg) || (told.add(msg), console.error(msg))

/**
 * A callback's answer, as Sanity's form: only `true` counts. One that throws or returns a
 * Promise leaves the field shown and editable, with the error in the console once
 * (Sanity's useCheckCondition).
 */
export function resolveConditional(property: ConditionalProperty, context: ConditionContext, name: string, log = true): boolean {
  if (typeof property !== 'function') return property === true
  let out: unknown
  try {
    out = property(context)
  } catch (err) {
    if (log) tell(`An error occurred while running the callback from \`${name}\`: ${(err as Error)?.message ?? err}`)
    return false
  }
  if (out && typeof (out as {then?: unknown}).then === 'function') {
    if (log) tell(`The \`${name}\` option is either a promise or a promise returning function. Async callbacks for \`${name}\` option is not currently supported.`)
    return false
  }
  return out === true
}

type Where = {path: string; value: unknown; parent?: Record<string, unknown>}
/** A config callback, which may ask who the person is: until that is known it cannot be answered. */
const awaitsPerson = (p: ConditionalProperty, person: Person) => person === undefined && typeof p === 'function'
/**
 * Who makes a write, for mayWrite: this person by hand (a key, a menu, an undo), "Keep mine" on
 * a clash, kept edits put back (a replay), or a document action's `set` (code the developer wrote).
 */
export type WriteBy = 'hand' | 'keep-mine' | 'replay' | 'action'
/**
 * Whether a write may go ahead: the one decision, made where the write is (lib/doc-lock.ts
 * writeAllowed asks it with what the doc's panes say now; lib/edits.ts acts on the answer).
 * Every write keeps the document lock. The field rule (fieldState's readOnly for this person)
 * stops a write by hand, Keep mine and a replay; an action's set is code and writes a field the
 * form shows read-only, as Sanity's patch.execute.
 */
export function mayWrite(by: WriteBy, now: {docLocked: boolean; fieldReadOnly: boolean}): 'ok' | 'document locked' | 'field read-only' {
  if (now.docLocked) return 'document locked'
  if (now.fieldReadOnly && by !== 'action') return 'field read-only'
  return 'ok'
}

/**
 * THE rule for whether this person may see and edit a field: hidden and readOnly from the
 * schema (`hidden`, `visibleWhen`, `readOnly`) and the studio config's callbacks for
 * `type.path`. Every surface that shows or edits a field asks it, directly or through a
 * helper built on it (fieldLock and pasteSkips for paste, form-lock's canvasAccess for the
 * Freeform canvas, doc-lock at save); fieldrule-scan.test.ts lists them. Until the person is known
 * (`person` undefined) a field with a callback is read-only, and hidden if its hidden is one:
 * it opens once Barkpark has said who, never the other way round. `at` defaults to a top-level
 * field (its parent the document), what the group tabs and Paste document ask about.
 */
export function fieldState(type: string, f: Field, doc: Record<string, unknown>, person: Person, rules: Record<string, FieldConditions> | undefined, at: Where = {path: f.name, value: doc[f.name]}) {
  const key = conditionKey(type, at.path)
  const rule = rules?.[key]
  const context = (): ConditionContext => ({currentUser: person ?? null, document: doc, parent: at.parent ?? doc, value: at.value, path: sanityPath(at.path)})
  const name = (p: string) => `form.conditions['${key}'].${p}`
  const asks = (p: ConditionalProperty, n: string) => p !== undefined && (awaitsPerson(p, person) || resolveConditional(p, context(), name(n)))
  const hidden = isHidden(f, doc, at.parent) || asks(rule?.hidden, 'hidden')
  // Not known yet, a hidden callback locks the field as well: its value is not this person's to change before they are known.
  const readOnly = isReadOnly(f, doc, at.parent) || awaitsPerson(rule?.hidden, person) || asks(rule?.readOnly, 'readOnly')
  return {hidden, readOnly}
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/**
 * A write to `path` (a field name, or a path into it as edits take it: "seo.metaTitle",
 * `links[_key=="a"].url`) is one this person may not make: fieldState says read-only at some
 * step on the way (a read-only object keeps all it holds). Steps the schema does not name are
 * judged by the nearest one it does, as the form draws them.
 */
export function pathReadOnly(type: string, fields: Field[], doc: Record<string, unknown>, person: Person, rules: Record<string, FieldConditions> | undefined, path: string): boolean {
  let here: Field[] | undefined = fields
  let value: unknown = doc
  let at = ''
  for (const s of segments(path)) {
    if ('key' in s) {
      at += `[_key=="${s.key}"]`
      value = Array.isArray(value) ? value.find((i) => isObj(i) && i._key === s.key) : undefined
      continue
    }
    const f: Field | undefined = here?.find((x) => x.name === s.name)
    if (!f) return false
    const parent = isObj(value) ? value : {}
    at = at ? `${at}.${s.name}` : s.name
    if (fieldState(type, f, doc, person, rules, {path: at, value: parent[s.name], parent}).readOnly) return true
    value = parent[s.name]
    here = f.fields ?? f.of?.fields
  }
  return false
}

const KNOWN_ROLES = Object.keys(ROLE_TITLES)
/**
 * Hidden from this person by a config role rule: the `form.conditions` hidden for `type.path`
 * hides the field from them on this data and shows it to some other role on the same data
 * (asked once per role: administrator, editor, contributor, viewer and their own). Hidden from
 * every role on this data is visibility from the data, no lock; so is anything with nobody
 * signed in (shared sign-in). A field shown only to another custom role, or by email, is no
 * lock either. Only the person's own answer logs a callback's error; a probe's never does.
 */
export function roleHidden(type: string, doc: Record<string, unknown>, currentUser: Person, rules: Record<string, FieldConditions> | undefined, at: Where): boolean {
  const key = conditionKey(type, at.path)
  const hidden = rules?.[key]?.hidden
  // Until the person is known, a hidden callback hides the field as fieldState does.
  if (awaitsPerson(hidden, currentUser)) return true
  if (!currentUser || hidden === undefined) return false
  const ask = (user: CurrentUser, log = false) => resolveConditional(hidden, {currentUser: user, document: doc, parent: at.parent ?? doc, value: at.value, path: sanityPath(at.path)}, `form.conditions['${key}'].hidden`, log)
  if (!ask(currentUser, true)) return false
  const roles = new Set([...KNOWN_ROLES, ...currentUser.roles.map((r) => r.name)])
  return [...roles].some((name) => !ask({...currentUser, roles: [{name, title: ROLE_TITLES[name] ?? name}]}))
}

/**
 * What a paste keeps (lib/paste-locked.ts): a field read-only for this person (the schema's
 * `readOnly` or the config's, on the document as it is), or hidden from them by a role rule
 * (roleHidden) on the document as it is or as the paste leaves it (`after`). Visibility from
 * the data (`visibleWhen`, the schema's `hidden`, a rule hiding the field from every role) is
 * no lock: such a field pastes as on main.
 */
export function fieldLock(type: string, f: Field, doc: Record<string, unknown>, currentUser: Person, rules: Record<string, FieldConditions> | undefined, at: Where = {path: f.name, value: doc[f.name]}, after?: {doc: Record<string, unknown>; at: Where}) {
  const readOnly = fieldState(type, f, doc, currentUser, rules, at).readOnly
  const hidden = roleHidden(type, doc, currentUser, rules, at) || (!!after && roleHidden(type, after.doc, currentUser, rules, after.at))
  return {readOnly, roleHidden: hidden}
}

/**
 * Paste document (J29) leaves a read-only field as it is and names it, as Sanity's paste
 * does, and a field a role rule hides as it is, unnamed (fieldLock). `after` is the document
 * as the paste leaves it.
 */
export function pasteSkips(type: string, fields: Field[], doc: Record<string, unknown>, currentUser: Person, rules: Record<string, FieldConditions> | undefined, after?: Record<string, unknown>) {
  const skip = new Set<string>()
  const named: string[] = []
  for (const f of fields) {
    const l = fieldLock(type, f, doc, currentUser, rules, undefined, after && {doc: after, at: {path: f.name, value: after[f.name]}})
    if (l.readOnly || l.roleHidden) skip.add(f.name)
    if (l.readOnly && !l.roleHidden) named.push(f.title ?? f.name)
  }
  return {skip, named}
}
