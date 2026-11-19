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
export const isHidden = (f: Field, doc: Record<string, unknown>, parent?: Record<string, unknown>) => f.hidden === true || (!!f.visibleWhen && !matches(f.visibleWhen, base(f.visibleWhen, doc, parent)))
export const isReadOnly = (f: Field, doc: Record<string, unknown>, parent?: Record<string, unknown>) =>
  f.readOnly === true || (typeof f.readOnly === 'object' && f.readOnly !== null && matches(f.readOnly, base(f.readOnly, doc, parent)))

/** Sanity shows a group's tab only while some field in it shows (`visibleGroups`): one whose fields are all hidden has none. */
export const groupShows = (fields: Field[], group: string, doc: Record<string, unknown>, hidden = (f: Field) => isHidden(f, doc)) => fields.some((f) => f.group === group && !hidden(f))

// Sanity's hidden and readOnly callbacks: `({currentUser, document, parent, value, path}) => boolean`.
// Barkpark's schemas are JSON, so the callbacks live in the studio config, `form.conditions`
// keyed `type.path` (lib/plugins.ts). A form convenience, as Sanity's: Barkpark's roles decide writes.

/** Sanity's CurrentUser: who is signed in, their role here under Sanity's role names. */
export type CurrentUser = {id: string; name: string; email: string; roles: {name: string; title: string}[]}
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
/** whoAmI as Sanity's currentUser; null with nobody signed in (shared sign-in) or while Barkpark has not said who. */
export function currentUserOf(me: Me | undefined): CurrentUser | null {
  if (!me?.email || me.provisional) return null
  const role = sanityRole(me.role, me.canWrite)
  return {id: me.userId ?? '', name: me.name ?? me.email, email: me.email, roles: role ? [{name: role, title: ROLE_TITLES[role] ?? role}] : []}
}

/** The config key of a field path: its type, then field names with array items left out (`post.links.title`). */
export const conditionKey = (type: string, path: string) => `${type}.${segments(path).flatMap((s) => ('name' in s ? [s.name] : [])).join('.')}`
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
/**
 * A field's hidden and readOnly: the schema's (`hidden`, `visibleWhen`, `readOnly`) or the
 * studio config's callbacks for `type.path`. `at` defaults to a top-level field (its parent
 * the document), what the group tabs and Paste document ask about.
 */
export function fieldState(type: string, f: Field, doc: Record<string, unknown>, currentUser: CurrentUser | null, rules: Record<string, FieldConditions> | undefined, at: Where = {path: f.name, value: doc[f.name]}) {
  const key = conditionKey(type, at.path)
  const rule = rules?.[key]
  const context = (): ConditionContext => ({currentUser, document: doc, parent: at.parent ?? doc, value: at.value, path: sanityPath(at.path)})
  const name = (p: string) => `form.conditions['${key}'].${p}`
  const hidden = isHidden(f, doc, at.parent) || (rule?.hidden !== undefined && resolveConditional(rule.hidden, context(), name('hidden')))
  const readOnly = isReadOnly(f, doc, at.parent) || (rule?.readOnly !== undefined && resolveConditional(rule.readOnly, context(), name('readOnly')))
  return {hidden, readOnly}
}

const KNOWN_ROLES = Object.keys(ROLE_TITLES)
/**
 * Hidden from this person by a config role rule: the `form.conditions` hidden for `type.path`
 * hides the field from them on this data and shows it to some other role on the same data
 * (asked once per role: administrator, editor, contributor, viewer, their own and each custom
 * role the config lists in `form.roles`, `roles` here). Hidden from every role on this data is
 * visibility from the data, no lock; so is anything with nobody signed in (shared sign-in). A
 * field shown only to a custom role not listed, or by email, is no lock either. Only the
 * person's own answer logs a callback's error; a probe's never does.
 */
export function roleHidden(type: string, doc: Record<string, unknown>, currentUser: CurrentUser | null, rules: Record<string, FieldConditions> | undefined, at: Where, roles: readonly string[] = []): boolean {
  const key = conditionKey(type, at.path)
  const hidden = rules?.[key]?.hidden
  if (!currentUser || hidden === undefined) return false
  const ask = (user: CurrentUser, log = false) => resolveConditional(hidden, {currentUser: user, document: doc, parent: at.parent ?? doc, value: at.value, path: sanityPath(at.path)}, `form.conditions['${key}'].hidden`, log)
  if (!ask(currentUser, true)) return false
  const probes = new Set([...KNOWN_ROLES, ...currentUser.roles.map((r) => r.name), ...roles])
  return [...probes].some((name) => !ask({...currentUser, roles: [{name, title: ROLE_TITLES[name] ?? name}]}))
}

/**
 * What a paste keeps (lib/paste-locked.ts): a field read-only for this person (the schema's
 * `readOnly` or the config's, on the document as it is), or hidden from them by a role rule
 * (roleHidden) on the document as it is or as the paste leaves it (`after`). Visibility from
 * the data (`visibleWhen`, the schema's `hidden`, a rule hiding the field from every role) is
 * no lock: such a field pastes as on main. `roles`: the config's `form.roles`.
 */
export function fieldLock(type: string, f: Field, doc: Record<string, unknown>, currentUser: CurrentUser | null, rules: Record<string, FieldConditions> | undefined, at: Where = {path: f.name, value: doc[f.name]}, after?: {doc: Record<string, unknown>; at: Where}, roles: readonly string[] = []) {
  const readOnly = fieldState(type, f, doc, currentUser, rules, at).readOnly
  const hidden = roleHidden(type, doc, currentUser, rules, at, roles) || (!!after && roleHidden(type, after.doc, currentUser, rules, after.at, roles))
  return {readOnly, roleHidden: hidden}
}

/**
 * Paste document (J29) leaves a read-only field as it is and names it, as Sanity's paste
 * does, and a field a role rule hides as it is, unnamed (fieldLock). `after` is the document
 * as the paste leaves it; `roles`, the config's `form.roles`.
 */
export function pasteSkips(type: string, fields: Field[], doc: Record<string, unknown>, currentUser: CurrentUser | null, rules: Record<string, FieldConditions> | undefined, after?: Record<string, unknown>, roles: readonly string[] = []) {
  const skip = new Set<string>()
  const named: string[] = []
  for (const f of fields) {
    const l = fieldLock(type, f, doc, currentUser, rules, undefined, after && {doc: after, at: {path: f.name, value: after[f.name]}}, roles)
    if (l.readOnly || l.roleHidden) skip.add(f.name)
    if (l.readOnly && !l.roleHidden) named.push(f.title ?? f.name)
  }
  return {skip, named}
}
