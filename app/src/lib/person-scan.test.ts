// task-4ffed14fbf52dc47: the person is one of three, known, nobody, or UNKNOWN (lib/conditions.ts
// Person), and no reader treats unknown as nobody. Read from the source:
// - a person comes only from lib/session.ts (useCurrentUser, personOf), which alone calls currentUserOf;
// - a lock site takes it whole and hands it, unread, to the rule (RECEIVERS): it never narrows it,
//   passes it to anything else, or hands the rule a nobody of its own;
// - only lib/conditions.ts names UNKNOWN and decides what waits on it;
// - no other file narrows a person itself (a typeof, `?? null`, `|| null`, the 'unknown' string);
// - whoAmI's role is read only by currentUserOf, and by READS_ROLE, each saying it waits while unknown;
// - the failed check is said only where something is closed (PersonCheckBanner, `ruled`).
import assert from 'node:assert/strict'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [join(dir, n)] : []))
const tree = (): Record<string, string> => Object.fromEntries(files(SRC).map((f) => [relative(SRC, f), readFileSync(f, 'utf8')]))
/** The code without its comments. */
const code = (text: string) => text.replace(/(^|[\s{(;,])\/\*[\s\S]*?\*\//gm, '$1').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

const HOME = 'lib/conditions.ts'
/** A person narrowed by hand: what only conditions.ts may do (it has awaitsPerson and personKnown for it). */
const PERSON = String.raw`\b(user|person|currentUser|me\.person)\b`
const NARROWS = [new RegExp(String.raw`typeof ${PERSON}`), new RegExp(String.raw`${PERSON}\s*(\?\?|\|\|)\s*null\b`), new RegExp(String.raw`${PERSON}\s*[!=]==?\s*'unknown'`), /'unknown'\s*[!=]==?\s*\b(user|person|currentUser)\b/]
/** whoAmI's role, read: by currentUserOf (conditions.ts), and these, each waiting while unknown. */
const READS_ROLE: Record<string, {why: string; waits: RegExp}> = {
  'components/Diagnostics.tsx': {why: 'Help > Diagnostics shows the role', waits: /me && !me\.provisional && !me\.unchecked \? \(me\.role/},
}

/** The one module a person comes from, and its only ways out. */
const SOURCE = 'lib/session.ts'
const SOURCES = /\bconst\s+([\w$]+)\s*=\s*(?:useCurrentUser\(\)|personOf\(\s*[\w$]+\s*\))/g
/** What a lock site may hand the person to, whole: the rule (conditions.ts, form-lock.ts, paste-reads.ts), or a ref holding it for the save's rule. */
const RECEIVERS = ['fieldState', 'pathReadOnly', 'freeformCanvas', 'pasteDocumentWith', 'pasteFieldWith', 'keptEditsWait', 'useRef', '.current =']
/** The rule's functions that take a person, and where: nobody of a site's own may be handed in. */
const TAKES_PERSON: Record<string, number> = {fieldState: 3, pathReadOnly: 3, fieldLock: 3, pasteSkips: 3, roleHidden: 2}
/** The banner's wiring: said only where something is closed. */
const BANNER: Record<string, RegExp> = {
  'components/DocumentPane.tsx': /<PersonCheckBanner docId=\{pane\.id\} ruled=\{roleRuled\(doc\._type, studio\.form\?\.conditions\)\}/,
  'components/PersonCheckBanner.tsx': /if \(!bannerShows\(\{failed, ruled, kept: keptAt !== null\}\)\) return null/,
}

/** The text between brackets at `open` (an index of `(`), split at its top-level commas. */
function args(c: string, open: number): string[] {
  const out: string[] = []
  let depth = 0
  let from = open + 1
  for (let i = open; i < c.length; i++) {
    const ch = c[i]!
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch) && --depth === 0) return [...out, c.slice(from, i)].map((a) => a.trim())
    else if (ch === ',' && depth === 1) out.push(c.slice(from, i)), (from = i + 1)
  }
  return out
}
/**
 * What the expression at `at` is handed to: the call it is an argument of (an object or array
 * literal in between carries it whole), `.current =` for an object put in a ref, or null.
 */
function handedTo(c: string, at: number): string | null {
  let depth = 0
  for (let i = at - 1; i >= 0; i--) {
    const ch = c[i]!
    if (')]}'.includes(ch)) depth++
    else if ('([{'.includes(ch) && depth > 0) depth--
    else if (ch === '(') return /([\w$]+)\s*$/.exec(c.slice(0, i))?.[1] ?? null
    else if (ch === '{') {
      const before = c.slice(0, i)
      if (/\.current\s*=\s*$/.test(before)) return '.current ='
      // A block (a function's or a statement's body): handed to nothing.
      if (/(\)|=>|^)\s*$/.test(before)) return null
    } else if (ch === ';') return null
  }
  return null
}

function judge(src: Record<string, string>) {
  const problems: string[] = []
  for (const [file, text] of Object.entries(src)) {
    const c = code(text)
    if (file === HOME) continue
    if (file !== SOURCE && /\bcurrentUserOf\(/.test(c)) problems.push(`${file} makes a person from whoAmI itself: take it from lib/session.ts (useCurrentUser, personOf)`)
    // Each person a lock site holds: handed whole to the rule, and to nothing else (words in strings are none).
    const bare = c.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (q) => `'${' '.repeat(q.length - 2)}'`)
    for (const [, name] of bare.matchAll(SOURCES)) {
      for (const m of bare.matchAll(new RegExp(String.raw`(?<![\w$.])${name!.replace('$', '\\$')}(?![\w$])`, 'g'))) {
        const at = m.index!
        if (/\bconst\s+$/.test(bare.slice(0, at))) continue
        const before = /\S?(?=\s*$)/.exec(bare.slice(Math.max(0, at - 80), at))?.[0] ?? ''
        const after = /^\s*(\S?)/.exec(bare.slice(at + name!.length))?.[1] ?? ''
        const to = handedTo(bare, at)
        if (!'(,{'.includes(before || 'x') || !',)}'.includes(after || 'x') || !to || !RECEIVERS.includes(to)) problems.push(`${file} reads the person ${name} (${bare.slice(Math.max(0, at - 30), at + name!.length + 12).replace(/\s+/g, ' ').trim()}): hand it whole to the rule (${RECEIVERS.join(', ')})`)
      }
    }
    // The rule handed a person: one a lock site took from lib/session.ts, never a nobody of its own.
    for (const [fn, n] of Object.entries(TAKES_PERSON)) for (const m of c.matchAll(new RegExp(String.raw`\b${fn}\(`, 'g'))) {
      const given = args(c, m.index! + fn.length)[n]
      if (given !== undefined && !/^[\w$]+(\.[\w$]+)*$/.test(given) || /^(null|undefined)$/.test(given ?? '')) problems.push(`${file} hands ${fn} a person of its own (${given}): hand it the one from lib/session.ts`)
    }
    if (/\b(user|person|currentUser)\s*:\s*(null|undefined)\b/.test(c)) problems.push(`${file} hands the rule nobody of its own: hand it the person from lib/session.ts`)
    if (/\bUNKNOWN\b/.test(c) && /from '[./]*(lib\/)?conditions(\.ts)?'/.test(c)) problems.push(`${file} reads UNKNOWN itself: ask lib/conditions.ts (personKnown, or a rule's answer)`)
    for (const re of NARROWS) if (re.test(c)) problems.push(`${file} narrows a person itself (${re.source}): an unknown person is never nobody; ask lib/conditions.ts`)
    const readsRole = /\bmeQuery\b|\bwhoAmI\b/.test(c) && /\bme\??\.role\b/.test(c)
    if (readsRole && !READS_ROLE[file]) problems.push(`${file} reads whoAmI's role: ask currentUserOf (lib/conditions.ts), or list it in person-scan.test.ts with how it waits while unknown`)
  }
  for (const [file, {waits}] of Object.entries(READS_ROLE)) if (!(file in src)) problems.push(`${file} is listed and gone`)
  else if (!waits.test(code(src[file]!).replace(/\s+/g, ' '))) problems.push(`${file} reads the role and no longer waits while unknown: ${waits}`)
  // At home: a person reaches a callback only once known, and unknown is UNKNOWN, never undefined or null.
  const home = code(src[HOME] ?? '')
  if (!/export type Person = CurrentUser \| null \| typeof UNKNOWN\b/.test(home)) problems.push(`${HOME}: Person is no longer known, nobody or UNKNOWN`)
  if (/\b(person|currentUser)\s*(\?\?|\|\|)\s*null\b/.test(home)) problems.push(`${HOME} turns a person into nobody with ?? or ||`)
  if (!/if \(!me \|\| me\.provisional \|\| me\.unchecked\) return UNKNOWN/.test(home)) problems.push(`${HOME}: currentUserOf no longer says UNKNOWN for a check not answered`)
  if (/\bexport\s+(const|function)\s+personKnown\b/.test(home)) problems.push(`${HOME} exports personKnown: only it asks whether the person is known`)
  for (const [file, re] of Object.entries(BANNER)) if (!re.test(code(src[file] ?? '').replace(/\s+/g, ' '))) problems.push(`${file}: the failed check is no longer said only where something is closed: ${re}`)
  return problems
}

test('no reader treats an unknown person as nobody', () => {
  assert.deepEqual(judge(tree()), [])
})

const fails = (file: string, text: string, why: RegExp) => assert.match(judge({...tree(), [file]: text}).join('\n'), why, file)

test('fails cases: UNKNOWN or the role read outside conditions.ts, a person narrowed by hand, a role read that does not wait', () => {
  fails('components/Badge.tsx', "import {UNKNOWN} from '../lib/conditions'\nexport const b = (user: unknown) => (user === UNKNOWN ? null : user)\n", /Badge\.tsx reads UNKNOWN itself/)
  fails('components/Lock.tsx', 'export const l = (user: never) => fieldState(t, f, d, user ?? null, r)\n', /Lock\.tsx narrows a person itself/)
  fails('lib/who.ts', "export const w = (person: unknown) => (typeof person === 'string' ? null : person)\n", /who\.ts narrows a person itself/)
  fails('lib/who2.ts', "export const w = (currentUser: unknown) => currentUser !== 'unknown' && currentUser\n", /who2\.ts narrows a person itself/)
  fails('components/Role.tsx', "const me = useQuery(meQuery).data\nexport const admin = me?.role === 'admin'\n", /Role\.tsx reads whoAmI's role/)
  const src = tree()
  fails(HOME, src[HOME]!.replace('if (!me || me.provisional || me.unchecked) return UNKNOWN', 'if (!me || me.provisional) return UNKNOWN'), /currentUserOf no longer says UNKNOWN/)
  fails(HOME, src[HOME]!.replace('export type Person = CurrentUser | null | typeof UNKNOWN', 'export type Person = CurrentUser | null | undefined'), /Person is no longer known, nobody or UNKNOWN/)
  fails('components/Diagnostics.tsx', src['components/Diagnostics.tsx']!.replace('me && !me.provisional && !me.unchecked ? (me.role', 'me ? (me.role'), /Diagnostics\.tsx reads the role and no longer waits/)
})

test('fails cases: a lock site that reads its person, hands it to anything but the rule, or hands the rule a nobody of its own', () => {
  const src = tree()
  const at = (file: string, from: string, to: string, why: RegExp) => {
    assert.ok(src[file]!.includes(from), `${file} holds ${from}`)
    fails(file, src[file]!.replace(from, to), why)
  }
  const TAKEN = 'const user = useCurrentUser()'
  // The reviewer's: unknown turned back into nobody at the site, at each lock site.
  const nobody = `const user0 = useCurrentUser()\n  const user = personKnown(user0) ? user0 : null`
  for (const file of ['components/Fields.tsx', 'components/DocHeaderMenu.tsx', 'components/DocumentPane.tsx']) {
    at(file, TAKEN, nobody, new RegExp(`${file.replace(/[./]/g, '\\$&')} reads the person user0`))
    // The second site in the file, too.
    const second = src[file]!.lastIndexOf(TAKEN)
    if (second !== src[file]!.indexOf(TAKEN)) fails(file, src[file]!.slice(0, second) + nobody + src[file]!.slice(second + TAKEN.length), /reads the person user0/)
  }
  at('lib/presentation-overlay.ts', 'const person = personOf(qc)', 'const who = personOf(qc)\n    const person = who === null || who === undefined ? null : who', /presentation-overlay\.ts reads the person who/)
  // Handed through a helper, an alias, or read for a field.
  at('components/Fields.tsx', 'fieldState(type, props.field, doc, user,', 'fieldState(type, props.field, doc, orNobody(user),', /Fields\.tsx reads the person user \(.*orNobody\(user\)/)
  at('components/DocHeaderMenu.tsx', TAKEN, `${TAKEN}\n  const who = user`, /DocHeaderMenu\.tsx reads the person user/)
  at('components/DocumentPane.tsx', TAKEN, `${TAKEN}\n  const roles = user && typeof user === 'object' ? user.roles : []`, /DocumentPane\.tsx reads the person user/)
  // The rule handed nobody of the site's own.
  at('components/DocumentPane.tsx', 'fieldState(schema.name, f, doc, user,', 'fieldState(schema.name, f, doc, null,', /DocumentPane\.tsx hands fieldState a person of its own \(null\)/)
  at('components/DocHeaderMenu.tsx', '{type: schema.name, doc, user, rules', '{type: schema.name, doc, user: null, rules', /DocHeaderMenu\.tsx hands the rule nobody of its own/)
  // A person made outside lib/session.ts; personKnown asked outside conditions.ts.
  fails('components/Who.tsx', "import {currentUserOf} from '../lib/conditions'\nexport const who = (me: never) => currentUserOf(me)\n", /Who\.tsx makes a person from whoAmI itself/)
  fails(HOME, src[HOME]!.replace('const personKnown =', 'export const personKnown ='), /exports personKnown/)
  // The failed check said on a doc with nothing closed.
  at('components/DocumentPane.tsx', 'ruled={roleRuled(doc._type, studio.form?.conditions)}', 'ruled={true}', /DocumentPane\.tsx: the failed check is no longer said only where something is closed/)
  at('components/PersonCheckBanner.tsx', 'if (!bannerShows({failed, ruled, kept: keptAt !== null})) return null', 'if (!failed) return null', /PersonCheckBanner\.tsx: the failed check is no longer said only where something is closed/)
})
