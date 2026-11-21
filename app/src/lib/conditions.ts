import type {Field} from './data'
import {segments} from './paths.ts'

// The person (task-4ffed14fbf52dc47). What this guards: a change anywhere in the app that would
// hand the rules a person other than the one made from the session's latest who-am-I answer reads
// as unknown, so fields with a role rule stay closed. What it does not guard: code that edits lib/session.ts, lib/person-source.ts,
// lib/me-query.ts or this file themselves (person-scan.test.ts pins them by export, review reads
// them), and a hostile browser (only the server can stop that).
// Nothing on the server or from hydrate is the session's: only the answer whoAmI's latest completed
// ask returned in the browser, kept by a closure no module exports (lib/me-query.ts, held by
// lib/session.ts); a failed ask clears it, and an older answer is never believed again. Until the
// browser's first answer, a field with a role rule stays closed: one who-am-I round trip, asked
// right after load (routes/__root.tsx), only where a role rule waits.

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
export type Condition = {field: string; operator: string; value?: unknown; valueField?: string; scope?: 'document' | 'parent'}

// Each rule below is Barkpark's own (api/lib/barkpark/content/field_visibility.ex, walk_path and
// apply_op), so a field shows, locks or breaks a cross rule here exactly when Barkpark says so.
// JSON has one "nothing" there (nil): a missing key, null and undefined are all null here.
// fixtures/field-visibility-cases.json pins the answers Barkpark gives (conditions-server.test.ts).
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// Dotted path from the document root. A missing or null step is null; a list on the way fans
// out over its rows, dropping rows where the path finds nothing and splicing lists it finds.
function lookup(doc: unknown, path: string[]): unknown {
  if (!path.length) return doc ?? null
  if (isMap(doc)) {
    const next = doc[path[0]!]
    return next === undefined || next === null ? null : lookup(next, path.slice(1))
  }
  if (Array.isArray(doc)) return doc.flatMap((row) => {
    const v = lookup(row, path)
    return v === null ? [] : Array.isArray(v) ? v : [v]
  })
  return null
}

/** Elixir's `==`: structural, with null for undefined. */
function same(a: unknown, b: unknown): boolean {
  a = a ?? null
  b = b ?? null
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (isMap(a) || isMap(b)) {
    if (!isMap(a) || !isMap(b)) return false
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && same(a[k], b[k]))
  }
  return a === b
}

// A list counts its rows, an object its keys, anything else 0.
const count = (v: unknown) => (Array.isArray(v) ? v.length : isMap(v) ? Object.keys(v).length : 0)
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (isMap(v) && Object.keys(v).length === 0)
// gt / gte / lt / lte: both numbers, or both non-empty strings (ISO dates compare as text).
// Anything else (a missing or empty side, mixed kinds) is not comparable, and the compare holds.
const comparable = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string' && a !== '' && b !== '')
/** Elixir's order: numbers by value, strings by code point (as UTF-8 bytes sort), not by UTF-16 unit. */
function order(a: unknown, b: unknown): number {
  if (typeof a === 'number') return a - (b as number)
  const x = [...(a as string)], y = [...(b as string)]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!
    if (d) return d
  }
  return x.length - y.length
}

export function matches(c: Condition, doc: Record<string, unknown>): boolean {
  if (typeof c.field !== 'string' || typeof c.operator !== 'string') return true // not a leaf: holds, as Barkpark's
  const v = lookup(doc, c.field.split('.'))
  // `valueField`: the other side is another field of the same root (Barkpark's `expected`).
  const n = typeof c.valueField === 'string' ? lookup(doc, c.valueField.split('.')) : c.value
  // count_*: only with a whole number; any other value holds (Barkpark's unknown-shape rule).
  const counted = typeof n === 'number' && Number.isInteger(n)
  switch (c.operator) {
    case 'eq':
      return same(v, n)
    case 'neq':
      return !same(v, n)
    case 'in':
      return Array.isArray(n) && n.some((x) => same(v, x))
    case 'empty':
      return isEmpty(v)
    case 'non_empty':
      return !isEmpty(v)
    case 'starts_with':
      return typeof v === 'string' && typeof n === 'string' && v.startsWith(n)
    case 'count_eq':
      return !counted || count(v) === n
    case 'count_neq':
      return !counted || count(v) !== n
    case 'count_gt':
      return !counted || count(v) > n
    case 'count_lt':
      return !counted || count(v) < n
    case 'gt':
      return !comparable(v, n) || order(v, n) > 0
    case 'gte':
      return !comparable(v, n) || order(v, n) >= 0
    case 'lt':
      return !comparable(v, n) || order(v, n) < 0
    case 'lte':
      return !comparable(v, n) || order(v, n) <= 0
    default:
      return true // an operator we don't know never hides a field
  }
}

/** A condition with `all` / `any` / `one` (Barkpark's holds?): each leaf reads its own scope. An empty `any` or `one` holds, as there. */
export function holds(c: unknown, doc: Record<string, unknown>, parent?: Record<string, unknown>): boolean {
  if (!isMap(c)) return true
  if (Array.isArray(c.all)) return c.all.every((x) => holds(x, doc, parent))
  if (Array.isArray(c.any) && c.any.length) return c.any.some((x) => holds(x, doc, parent))
  // Exactly one of them holds.
  if (Array.isArray(c.one) && c.one.length) return c.one.filter((x) => holds(x, doc, parent)).length === 1
  return matches(c as Condition, base(c as Condition, doc, parent))
}

/** What a condition reads from: the enclosing object for scope "parent" (the document when there is none). */
const base = (c: Condition, doc: Record<string, unknown>, parent?: Record<string, unknown>) => (c.scope === 'parent' && parent ? parent : doc)
/** The schema's `hidden: true` (Barkpark's, Sanity's): never in the form, whatever the document; its value kept (a manual order's orderRank). */
export const alwaysHidden = (f: Field) => f.hidden === true
/** The schema's `readOnly: true`, whatever the document. */
export const alwaysReadOnly = (f: Field) => f.readOnly === true
const readOnlyWhen = (f: Field) => (typeof f.readOnly === 'object' && f.readOnly !== null ? f.readOnly : undefined)
export const isHidden = (f: Field, doc: Record<string, unknown>, parent?: Record<string, unknown>) => alwaysHidden(f) || (!!f.visibleWhen && !holds(f.visibleWhen, doc, parent))
export const isReadOnly = (f: Field, doc: Record<string, unknown>, parent?: Record<string, unknown>) => {
  const when = readOnlyWhen(f)
  return alwaysReadOnly(f) || (!!when && holds(when, doc, parent))
}
/** The document's own rule alone (no person): the field is hidden or read-only here. Validation's question: can the editor change it? */
export const shutByDoc = (f: Field, doc: Record<string, unknown>, parent?: Record<string, unknown>) => isHidden(f, doc, parent) || isReadOnly(f, doc, parent)

/** Sanity shows a group's tab only while some field in it shows (`visibleGroups`): one whose fields are all hidden has none. */
export const groupShows = (fields: Field[], group: string, doc: Record<string, unknown>, hidden = (f: Field) => isHidden(f, doc)) => fields.some((f) => f.group === group && !hidden(f))

// Sanity's hidden and readOnly callbacks: `({currentUser, document, parent, value, path}) => boolean`.
// Barkpark's schemas are JSON, so the callbacks live in the studio config, `form.conditions`
// keyed `type.path` (lib/plugins.ts). A form convenience, as Sanity's: Barkpark's roles decide writes.

/** Sanity's CurrentUser: who is signed in, their role here under Sanity's role names. */
export type CurrentUser = {id: string; name: string; email: string; roles: {name: string; title: string}[]}
/** Who the person is not known yet: whoAmI not read, a provisional stand-in, or a check Barkpark did not answer. Never nobody. */
const UNKNOWN: unique symbol = Symbol('unknown')
/** The seal on a person: not exported, so no other file can make one. */
declare const sealed: unique symbol
type Known = Readonly<CurrentUser> & {readonly [sealed]: 'known'}
/** Nobody signed in (shared sign-in): a role rule's callbacks get `currentUser: null`. */
type Nobody = {readonly [sealed]: 'nobody'}
/**
 * The person a field is judged for, one of three: known (a CurrentUser), nobody signed in, or
 * unknown. Only a maker (mint) makes one, and only its one taker has it (takeMint:
 * lib/person-source.ts). The rule believes only what the maker handed out now made (checked):
 * anything else, a look-alike, a copy, a clone, null, any `any`, a person made by a maker handed
 * back, is unknown, so the field locks. A field with a role rule waits while the person is
 * unknown (awaitsPerson); the marker for unknown never leaves this file.
 * Not held: a known person minted before a check failed is still believed if a component keeps
 * one (task-17875b8357355194; person-scan.test.ts refuses keeping one in a ref or a `let`).
 */
export type Person = Known | Nobody | typeof UNKNOWN
/** Sanity's Path: field names and array items by `_key`. */
export type PathSegment = string | {_key: string}
export type ConditionContext = {currentUser: CurrentUser | null; document: Record<string, unknown>; parent: unknown; value: unknown; path: PathSegment[]}
/** Sanity's ConditionalProperty. */
export type ConditionalProperty = boolean | ((context: ConditionContext) => boolean) | undefined
export type FieldConditions = {hidden?: ConditionalProperty; readOnly?: ConditionalProperty}

const ROLE_TITLES: Record<string, string> = {administrator: 'Administrator', editor: 'Editor', contributor: 'Contributor', viewer: 'Viewer'}
/** A role's title: Sanity's for the built-in four (own keys only, so `constructor` is no title), else its name. */
const roleTitle = (name: string) => (Object.hasOwn(ROLE_TITLES, name) ? ROLE_TITLES[name] : name)

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

type Me = {email: string | null; name: string | null; userId: string | null; role: string | null; canWrite: boolean; provisional?: boolean; unchecked?: boolean}
type Maker = (me: Me | undefined) => Person
/** Each person a maker made (known, or its nobody), by that maker. */
const madeBy = new WeakMap<object, Maker>()
const nobodies = new WeakSet<object>()
/** The maker handed out now, if any. */
let taken: Maker | null = null
/**
 * A maker of people: whoAmI as Sanity's currentUser. Nobody signed in (shared sign-in); unknown
 * while Barkpark has not said who (not read yet, a provisional stand-in, or a check it did not
 * answer); else who it is, frozen all the way down, so no role can be added to it. It makes
 * nothing once handed back, and what it made is no longer believed.
 */
function mint(): Maker {
  const nobody = Object.freeze({}) as Nobody
  const maker: Maker = (me) => {
    if (maker !== taken) throw new Error('This person maker was handed back: a person comes only from lib/person-source.ts (useCurrentUser, personOf).')
    if (!me || me.provisional || me.unchecked) return UNKNOWN
    if (!me.email) return nobody
    const role = sanityRole(me.role, me.canWrite)
    const roles = Object.freeze(role ? [Object.freeze({name: role, title: roleTitle(role)})] : [])
    const known = Object.freeze({id: me.userId ?? '', name: me.name ?? me.email, email: me.email, roles}) as unknown as Known
    madeBy.set(known, maker)
    return known
  }
  nobodies.add(nobody)
  madeBy.set(nobody, maker)
  return maker
}
/**
 * The maker of a person, handed out once: lib/person-source.ts takes it as it loads (the tests'
 * people, lib/persons.fixture.ts, in a test run); a second taker throws, so nothing else ever
 * makes a person.
 */
export function takeMint() {
  if (taken) throw new Error('The person maker is taken: a person comes only from lib/person-source.ts (useCurrentUser, personOf).')
  return (taken = mint())
}
/** Not a build (Vite's import.meta.env.DEV is false in one): a dev server, or a test run. */
const DEV = import.meta.env?.DEV !== false
/**
 * A dev reload of lib/person-source.ts hands its maker back before it takes a new one: that maker
 * stops, and what it made is no longer believed. In a build nothing is handed back.
 */
export const giveMintBack = (m: unknown) => void (DEV && m !== null && m === taken && (taken = null))

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
const awaitsPerson = (p: ConditionalProperty, person: Person): person is typeof UNKNOWN => person === UNKNOWN && typeof p === 'function'
/** Whether the person is known (or known to be nobody). Only this file asks (person-scan.test.ts). */
const personKnown = (person: Person): person is Known | Nobody => person !== UNKNOWN
const isNobody = (person: Person): person is Nobody => nobodies.has(person as object)
/** Whether `mint` made this: a person any other way (a copy, a clone, an object made on one, null, any `any`) is not. */
const isMinted = (p: unknown): p is Person => p === UNKNOWN || (typeof p === 'object' && p !== null && taken !== null && madeBy.get(p) === taken)
/** The person as the rule takes it, first thing at each way in: what `mint` made, or else unknown. */
const checked = (p: unknown): Person => (isMinted(p) ? p : UNKNOWN)
/** A known person (or nobody) as Sanity's callbacks take it: a copy as `currentUser`, or null. Never the person itself. */
const sanityUser = (person: Known | Nobody): CurrentUser | null => (isNobody(person) ? null : {...person, roles: person.roles.map((r) => ({...r}))})
/** Whether kept edits wait to be put back: until the person is known, a role rule may lock a field they hold. */
export const keptEditsWait = (person: Person) => !personKnown(checked(person))
/** Whether a type has a role rule: a `form.conditions` callback under `type.`, which waits while the person is unknown. */
export const roleRuled = (type: string, rules: Record<string, FieldConditions> | undefined) =>
  Object.entries(rules ?? {}).some(([key, c]) => key.startsWith(`${type}.`) && (typeof c.hidden === 'function' || typeof c.readOnly === 'function'))
/** Whether any type has a role rule (a callback, which may read the person). */
export const roleRules = (rules: Record<string, FieldConditions> | undefined) => Object.values(rules ?? {}).some((c) => typeof c.hidden === 'function' || typeof c.readOnly === 'function')
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
 * (`person` UNKNOWN) a field with a callback is read-only, and hidden if its hidden is one:
 * it opens once Barkpark has said who, never the other way round. `at` defaults to a top-level
 * field (its parent the document), what the group tabs and Paste document ask about.
 */
export function fieldState(type: string, f: Field, doc: Record<string, unknown>, who: Person, rules: Record<string, FieldConditions> | undefined, at: Where = {path: f.name, value: doc[f.name]}) {
  const person = checked(who)
  const key = conditionKey(type, at.path)
  const rule = rules?.[key]
  // A callback is asked only of a known person (awaitsPerson first); a plain true or false asks nobody.
  const context = (known: CurrentUser | null): ConditionContext => ({currentUser: known, document: doc, parent: at.parent ?? doc, value: at.value, path: sanityPath(at.path)})
  const name = (p: string) => `form.conditions['${key}'].${p}`
  const asks = (p: ConditionalProperty, n: string) => p !== undefined && (awaitsPerson(p, person) || (personKnown(person) ? resolveConditional(p, context(sanityUser(person)), name(n)) : p === true))
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
export function pathReadOnly(type: string, fields: Field[], doc: Record<string, unknown>, who: Person, rules: Record<string, FieldConditions> | undefined, path: string): boolean {
  const person = checked(who)
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
 * (asked once per role: administrator, editor, contributor, viewer, their own and each role the
 * workspace defines, `roles` here: Barkpark's names, under Sanity's by sanityRole). Without
 * `roles` (Barkpark did not say) the first five only. Hidden from every role on this data is
 * visibility from the data, no lock; so is anything with nobody signed in (shared sign-in). A
 * field shown only by email is no lock either. Only the person's own answer logs a callback's
 * error; a probe's never does.
 */
export function roleHidden(type: string, doc: Record<string, unknown>, who: Person, rules: Record<string, FieldConditions> | undefined, at: Where, roles: readonly string[] = []): boolean {
  const currentUser = checked(who)
  const key = conditionKey(type, at.path)
  const hidden = rules?.[key]?.hidden
  // Until the person is known, a hidden callback hides the field as fieldState does.
  if (awaitsPerson(hidden, currentUser)) return true
  if (!personKnown(currentUser) || isNobody(currentUser) || hidden === undefined) return false
  const ask = (user: CurrentUser, log = false) => resolveConditional(hidden, {currentUser: user, document: doc, parent: at.parent ?? doc, value: at.value, path: sanityPath(at.path)}, `form.conditions['${key}'].hidden`, log)
  if (!ask(sanityUser(currentUser)!, true)) return false
  const probes = new Set([...KNOWN_ROLES, ...currentUser.roles.map((r) => r.name), ...roles.flatMap((r) => sanityRole(r) ?? [])])
  return [...probes].some((name) => !ask({...currentUser, roles: [{name, title: roleTitle(name)}]}))
}

/**
 * What a paste keeps (lib/paste-locked.ts): a field read-only for this person (the schema's
 * `readOnly` or the config's, on the document as it is), or hidden from them by a role rule
 * (roleHidden) on the document as it is or as the paste leaves it (`after`). Visibility from
 * the data (`visibleWhen`, the schema's `hidden`, a rule hiding the field from every role) is
 * no lock: such a field pastes as on main. `roles`: the workspace's roles (roleHidden).
 */
export function fieldLock(type: string, f: Field, doc: Record<string, unknown>, who: Person, rules: Record<string, FieldConditions> | undefined, at: Where = {path: f.name, value: doc[f.name]}, after?: {doc: Record<string, unknown>; at: Where}, roles: readonly string[] = []) {
  const currentUser = checked(who)
  const readOnly = fieldState(type, f, doc, currentUser, rules, at).readOnly
  const hidden = roleHidden(type, doc, currentUser, rules, at, roles) || (!!after && roleHidden(type, after.doc, currentUser, rules, after.at, roles))
  return {readOnly, roleHidden: hidden}
}

/**
 * Paste document (J29) leaves a read-only field as it is and names it, as Sanity's paste
 * does, and a field a role rule hides as it is, unnamed (fieldLock). `after` is the document
 * as the paste leaves it; `roles`, the workspace's roles (roleHidden).
 */
export function pasteSkips(type: string, fields: Field[], doc: Record<string, unknown>, who: Person, rules: Record<string, FieldConditions> | undefined, after?: Record<string, unknown>, roles: readonly string[] = []) {
  const currentUser = checked(who)
  const skip = new Set<string>()
  const named: string[] = []
  for (const f of fields) {
    const l = fieldLock(type, f, doc, currentUser, rules, undefined, after && {doc: after, at: {path: f.name, value: after[f.name]}}, roles)
    if (l.readOnly || l.roleHidden) skip.add(f.name)
    if (l.readOnly && !l.roleHidden) named.push(f.title ?? f.name)
  }
  return {skip, named}
}
