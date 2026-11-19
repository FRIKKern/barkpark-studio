// task-4ffed14fbf52dc47: the person is one of three, known, nobody, or UNKNOWN (lib/conditions.ts
// Person), and no reader treats unknown as nobody. Read from the source:
// - only lib/conditions.ts names UNKNOWN and decides what waits on it (awaitsPerson, personKnown);
// - no other file narrows a person itself (a typeof, `?? null`, `|| null`, the 'unknown' string);
// - whoAmI's role is read only by currentUserOf, and by READS_ROLE, each saying it waits while unknown.
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

function judge(src: Record<string, string>) {
  const problems: string[] = []
  for (const [file, text] of Object.entries(src)) {
    const c = code(text)
    if (file === HOME) continue
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
  return problems
}

test('no reader treats an unknown person as nobody', () => {
  assert.deepEqual(judge(tree()), [])
})

const fails = (file: string, text: string, why: RegExp) => assert.match(judge({...tree(), [file]: text}).join('\n'), why, file)

test('the scan names a reader that treats unknown as nobody, whatever its spelling', () => {
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
