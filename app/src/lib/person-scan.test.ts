// task-4ffed14fbf52dc47: the person is one of three, known, nobody, or unknown (lib/conditions.ts
// Person), and no reader treats unknown as nobody. The first wall is the rule itself: it believes
// only a person its one maker minted (conditions.ts checked), and reads anything else, a copy, a
// clone, null, any `any`, as unknown, so the field locks. The maker is handed out once
// (takeMint), to lib/person-source.ts. The second wall is the type: a Person is sealed, so a lock
// site cannot write a nobody or a compare-and-replace that tsc takes. This scan is the third,
// read from the parse (oxc, source-tree.fixture.ts) of every file but the tests:
// - only lib/person-source.ts takes the maker (it holds no server function, so the server never
//   loads it twice: TanStack Start loads a module with server functions twice), and the tests'
//   people (persons.fixture.ts) are imported by no source file;
// - a lock site takes the person one way: the whole initializer of a `const <name>`, from
//   `useCurrentUser()` or `personOf(<qc>)`; a named function may take it as a parameter typed Person;
// - that name is used only as the person argument of a rule function (RULES, or such a named
//   function), or in a hook's dependency list: never compared, reassigned, put in String(), read
//   from, put in an object or array, spread, returned, or handed to anything else;
// - a rule function called by its name is handed such a name as the person, never a call, a
//   literal or a conditional; it is only ever called; the rule's modules are reached only by
//   named imports (RULE_MODULES);
// - no `as`, `any` or `@ts-` on (or, for `@ts-`, above) a line with the person; every file parses;
// - in conditions.ts only `mint` makes a person, and the markers stay in the file; whoAmI's answer
//   is meOf's; whoAmI's role is read by the maker and READS_ROLE, each waiting while unknown; the
//   failed check is said only where something is closed (PersonCheckBanner, `ruled`).
// What it cannot see: it goes by name, not scope, so a name taken as the person is held to this in
// its whole file (it fails closed). Inside the rule (INSIDE) the person rides in a paste context,
// which lock sites reach only through lib/paste-reads.ts (fieldrule-scan.test.ts). A Person named
// through a type alias is no person here (fails closed). A rule that decides wrong in its own file
// is for the unit tests to catch. And a known person minted before a check failed is still a
// person the rule believes, if a component keeps one (task-17875b8357355194); this scan refuses
// keeping one in a ref or a `let`.
import assert from 'node:assert/strict'
import {dirname, join, normalize} from 'node:path'
import {test} from 'node:test'
import {parse, tree, visit, type Node} from './source-tree.fixture.ts'

/** The code without its comments. Kept by text: each judge reads every file again, and most are the same. */
const stripped = new Map<string, string>()
const code = (text: string) => {
  if (!stripped.has(text)) stripped.set(text, text.replace(/(^|[\s{(;,])\/\*[\s\S]*?\*\//gm, '$1').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, ''))
  return stripped.get(text)!
}

const HOME = 'lib/conditions.ts'
/** People for the tests, made by the maker it takes in a test run: no source file imports it. */
const TEST_PEOPLE = 'lib/persons.fixture.ts'
/** The one module a person comes from, and its only ways out. */
const SOURCE = 'lib/person-source.ts'
/** Where whoAmI is. */
const SESSION = 'lib/session.ts'
const TAKES = new Set(['useCurrentUser', 'personOf'])
/** The rule's insides, where the person rides in a paste context (`c.user`). */
const INSIDE = new Set([HOME, 'lib/paste-locked.ts'])
/** The modules that are the rule: reached only by named imports, so each call of a rule function is a call by its name. */
const RULE_MODULES = ['lib/conditions', 'lib/form-lock', 'lib/paste-reads', 'lib/paste-locked']
/** A dynamic import by a computed path, and why it is no way to the rule. */
const COMPUTED_IMPORTS: Record<string, string> = {'components/DocEditors.tsx': 'loads a built chunk again by its own URL, after it failed to load'}
/** The rule's functions that take a person, and where (0-based): nothing else may be handed it. */
const RULES: Record<string, number> = {fieldState: 3, pathReadOnly: 3, fieldLock: 3, pasteSkips: 3, roleHidden: 2, keptEditsWait: 0, canvasAccess: 0, freeformCanvas: 1, paneFieldLock: 1, pasteDocumentWith: 3, pasteFieldWith: 5, pasteDocumentReading: 3, pasteFieldReading: 5}
/** Hooks whose dependency list may name the person: a list is no read. */
const DEPS = new Set(['useMemo', 'useEffect', 'useLayoutEffect', 'useCallback'])
/** whoAmI's role, read: by currentUserOf (conditions.ts), and these, each waiting while unknown. */
const READS_ROLE: Record<string, {why: string; waits: RegExp}> = {
  'components/Diagnostics.tsx': {why: 'Help > Diagnostics shows the role', waits: /me && !me\.provisional && !me\.unchecked \? \(me\.role/},
}
/** The banner's wiring: said only where something is closed. */
const BANNER: Record<string, RegExp> = {
  'components/DocumentPane.tsx': /<PersonCheckBanner docId=\{pane\.id\} ruled=\{roleRuled\(doc\._type, studio\.form\?\.conditions\)\}/,
  'components/PersonCheckBanner.tsx': /if \(!bannerShows\(\{failed, ruled, kept: keptAt !== null\}\)\) return null/,
}

const starts = new Map<string, number[]>()
/** The 1-based line of offset `at` in `text`. */
function lineOf(text: string, at: number) {
  let s = starts.get(text)
  if (!s) starts.set(text, (s = [0, ...[...text.matchAll(/\n/g)].map((m) => m.index! + 1)]))
  let [lo, hi] = [0, s.length - 1]
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (s[mid]! <= at) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}
const show = (text: string, n: Node) => `line ${lineOf(text, n.start)}: ${text.split('\n')[lineOf(text, n.start) - 1]!.trim().slice(0, 100)}`
const isFunction = (n: Node) => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression'
/** A function's name: its own, or the `const` it initializes. */
const fnName = (n: Node, up: readonly Node[]): string | undefined => n.id?.name ?? (up.at(-1)?.type === 'VariableDeclarator' && up.at(-1)!.init === n && up.at(-1)!.id.type === 'Identifier' ? up.at(-1)!.id.name : undefined)
/** A name in a key's place (`{key: …}`, `a.key`, a type's member): no use of a binding. */
const isKey = (n: Node, parent: Node) => (parent.type === 'MemberExpression' && parent.property === n && !parent.computed) || (parent.key === n && !parent.computed)

/** What a file says about the person: the local names of conditions.ts's Person, and its named functions that take one (by name, where). */
const facts = new Map<string, {personTypes: Set<string>; helpers: Record<string, number>; anonymous: Node[]}>()
function factsOf(file: string, text: string) {
  const key = `${file}\0${text}`
  if (facts.has(key)) return facts.get(key)!
  const {program} = parse(file, text)
  const personTypes = new Set<string>()
  for (const n of program.body) if (n.type === 'ImportDeclaration' && /(^|\/)conditions(\.ts)?$/.test(n.source.value)) for (const s of n.specifiers) if (s.type === 'ImportSpecifier' && (s.imported.name ?? s.imported.value) === 'Person') personTypes.add(s.local.name)
  const helpers: Record<string, number> = {}
  const anonymous: Node[] = []
  if (personTypes.size) visit(program, (n, up) => {
    if (!isFunction(n)) return
    n.params.forEach((p: Node, i: number) => {
      const id = p.type === 'AssignmentPattern' ? p.left : p
      const t = id.typeAnnotation?.typeAnnotation
      if (id.type !== 'Identifier' || t?.type !== 'TSTypeReference' || t.typeName.type !== 'Identifier' || !personTypes.has(t.typeName.name)) return
      const name = fnName(n, up)
      if (name) helpers[name] = i
      else anonymous.push(n)
    })
  })
  const out = {personTypes, helpers, anonymous}
  facts.set(key, out)
  return out
}

/** A lock site's person, from the parse: taken one way, handed only to the rule. Kept per text and rule list. */
const sites = new Map<string, string[]>()
function siteProblems(file: string, text: string, helpers: Record<string, number>, helpersKey: string): string[] {
  const key = `${file}\0${helpersKey}\0${text}`
  if (sites.has(key)) return sites.get(key)!
  // A file that names no source, rule function or Person has no person to read (most files: skipped).
  const words = new RegExp(String.raw`\b(${[...TAKES, ...Object.keys(RULES), ...Object.keys(helpers), 'Person'].join('|')})\b`)
  if (!words.test(text)) return sites.set(key, []), []
  const problems: string[] = []
  const {program, comments} = parse(file, text)
  const {personTypes, anonymous} = factsOf(file, text)
  const line = (n: Node) => lineOf(text, n.start)
  const rules: Record<string, number> = {...helpers, ...RULES}
  const aliases = new Map<string, number>()
  for (const n of program.body) if (n.type === 'ImportDeclaration') for (const s of n.specifiers) if (s.type === 'ImportSpecifier' && Object.hasOwn(rules, s.imported.name ?? s.imported.value)) aliases.set(s.local.name, rules[s.imported.name ?? s.imported.value]!)
  const ruleAt = (name: string) => aliases.get(name)
  const calleeName = (call: Node): string | undefined => (call.callee.type === 'Identifier' ? call.callee.name : call.callee.type === 'MemberExpression' && !call.callee.computed ? call.callee.property.name : undefined)
  const personAt = (call: Node) => (call.type === 'CallExpression' && calleeName(call) !== undefined ? (call.callee.type === 'Identifier' ? ruleAt(call.callee.name) : Object.hasOwn(rules, calleeName(call)!) ? rules[calleeName(call)!] : undefined) : undefined)

  // The people: a `const` taken from lib/session.ts, or a named function's parameter typed Person.
  const names = new Set<string>()
  const binds = new Set<Node>()
  for (const n of anonymous) problems.push(`${file} takes a Person in a function with no name (${show(text, n)}): name it, so the scan holds what its callers hand it`)
  visit(program, (n, up) => {
    // A rule function by the name this file has it: imported (under any local name, above), or its own function.
    const own = n.type === 'FunctionDeclaration' ? n.id?.name : isFunction(n) ? fnName(n, up) : undefined
    if (own && Object.hasOwn(rules, own)) aliases.set(own, rules[own]!)
    if (n.type === 'Identifier' && TAKES.has(n.name)) {
      const [call, decl, list] = [up.at(-1), up.at(-2), up.at(-3)]
      if (call?.type === 'ImportSpecifier') return
      const args = call?.type === 'CallExpression' && call.callee === n ? call.arguments : null
      const plain = n.name === 'useCurrentUser' ? args?.length === 0 : args?.length === 1 && args[0].type === 'Identifier'
      if (plain && decl?.type === 'VariableDeclarator' && decl.init === call && decl.id.type === 'Identifier' && list?.type === 'VariableDeclaration' && list.kind === 'const') names.add(decl.id.name), binds.add(decl.id)
      else problems.push(`${file} takes the person another way (${show(text, n)}): only \`const <name> = useCurrentUser()\` or \`const <name> = personOf(<qc>)\``)
    }
    if (isFunction(n) && fnName(n, up))
      for (const p of n.params) {
        const id = p.type === 'AssignmentPattern' ? p.left : p
        const t = id.typeAnnotation?.typeAnnotation
        if (id.type === 'Identifier' && t?.type === 'TSTypeReference' && t.typeName.type === 'Identifier' && personTypes.has(t.typeName.name)) names.add(id.name), binds.add(id)
      }
  })

  // Each use of a person: the rule's person argument, or a hook's dependency.
  const touched = new Set<number>()
  const ways: Node[] = []
  visit(program, (n, up) => {
    const parent = up.at(-1)!
    if (n.type === 'Identifier' && names.has(n.name) && !isKey(n, parent)) {
      touched.add(line(n))
      const hook = up.at(-2)
      const handed = parent.type === 'CallExpression' && personAt(parent) !== undefined && parent.arguments[personAt(parent)!] === n
      const listed = parent.type === 'ArrayExpression' && hook?.type === 'CallExpression' && DEPS.has(calleeName(hook) ?? '') && hook.arguments[1] === parent
      if (!binds.has(n) && !handed && !listed) problems.push(`${file} reads the person ${n.name} (${show(text, n)}): hand it only to the rule (${Object.keys(RULES).join(', ')}), or name it in a hook's dependency list`)
    }
    // The other end: what each rule call is handed as the person.
    if (n.type === 'CallExpression' && personAt(n) !== undefined) {
      const arg = n.arguments[personAt(n)!]
      if (arg) for (let l = line(arg); l <= lineOf(text, arg.end); l++) touched.add(l)
      if (arg?.type !== 'Identifier' || !names.has(arg.name)) problems.push(`${file} hands ${calleeName(n)} a person not taken from lib/session.ts (${show(text, arg ?? n)}): a \`const\` from useCurrentUser() or personOf(qc), or a parameter typed Person`)
    }
    // A rule function is only called: put anywhere else, what it is handed is out of sight.
    if (n.type === 'Identifier' && ruleAt(n.name) !== undefined && !isKey(n, parent)) {
      const named = (parent.type === 'CallExpression' && parent.callee === n) || parent.type === 'ImportSpecifier' || parent.type === 'TSTypeQuery' || (parent.id === n && (parent.type === 'VariableDeclarator' || parent.type === 'FunctionDeclaration'))
      if (!named) problems.push(`${file} uses ${n.name} as a value (${show(text, n)}): call it, so the scan sees what it is handed`)
    }
    if (n.type === 'TSTypeReference' && n.typeName.type === 'Identifier' && personTypes.has(n.typeName.name)) touched.add(line(n))
    if (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSTypeAssertion' || n.type === 'TSAnyKeyword') ways.push(n)
  })
  // No way round the type on a line with the person.
  for (const n of ways) {
    if (n.type !== 'TSAnyKeyword' && touched.has(line(n.typeAnnotation))) problems.push(`${file} writes \`as\` on a line with the person (${show(text, n.typeAnnotation)})`)
    if (n.type === 'TSAnyKeyword' && touched.has(line(n))) problems.push(`${file} writes \`any\` on a line with the person (${show(text, n)})`)
  }
  for (const c of comments)
    if (c.value.includes('@ts-') && touched.size && (c.value.includes('@ts-nocheck') || touched.has(lineOf(text, c.start)) || touched.has(lineOf(text, c.end) + 1))) problems.push(`${file} writes \`@ts-\` on or above a line with the person (line ${lineOf(text, c.start)})`)
  sites.set(key, problems)
  return problems
}

/** whoAmI's answer is meOf's: `const me = meOf(…)`, returned as it is, or with the e2e stand-in's email and noSeat. */
function whoAmIProblems(text: string): string[] {
  let handler: Node | undefined
  visit(parse(SESSION, text).program, (n, up) => {
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'handler' && up.some((u) => u.type === 'VariableDeclarator' && u.id.name === 'whoAmI')) handler = n.arguments[0]
  })
  if (!handler) return [`${SESSION}: whoAmI's handler is gone`]
  const problems: string[] = []
  let made = false
  const returns: Node[] = []
  visit(handler.body, (n, up) => {
    if (up.some(isFunction)) return
    if (n.type === 'VariableDeclarator' && n.id.name === 'me') made = n.init?.type === 'CallExpression' && n.init.callee.name === 'meOf'
    if (n.type === 'ReturnStatement') returns.push(n.argument)
  })
  const meOrStandIn = (n: Node | null): boolean =>
    !!n && ((n.type === 'Identifier' && n.name === 'me') || (n.type === 'ConditionalExpression' && meOrStandIn(n.consequent) && meOrStandIn(n.alternate)) || (n.type === 'ObjectExpression' && n.properties[0]?.type === 'SpreadElement' && n.properties[0].argument.name === 'me' && n.properties.slice(1).every((p: Node) => ['email', 'noSeat'].includes(p.key?.name))))
  if (!made || !returns.length || !returns.every(meOrStandIn)) problems.push(`${SESSION}: whoAmI's answer is no longer meOf's (lib/me-of.ts, whose tests say what a check not answered gives)`)
  return problems
}

/** In conditions.ts, only `mint` makes a person: casts to it, a marker handed out, a function said to return one. */
const SEALED = /\b(Known|Person|NOBODY|sealed)\b/
function sealProblems(text: string): string[] {
  const problems: string[] = []
  const {program} = parse(HOME, text)
  const said = (n: Node | undefined) => !!n && SEALED.test(text.slice(n.start, n.end))
  visit(program, (n, up) => {
    // mint makes a person; checked makes anything it did not unknown.
    const inMaker = up.some((u) => (u.type === 'FunctionDeclaration' && u.id?.name === 'mint') || (u.type === 'VariableDeclarator' && u.id.name === 'checked'))
    if ((n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSTypeAssertion') && said(n.typeAnnotation) && !inMaker) problems.push(`${HOME} casts to the person outside mint (${show(text, n.typeAnnotation)})`)
    const parent = up.at(-1)!
    if (n.type === 'Identifier' && (n.name === 'NOBODY' || n.name === 'UNKNOWN') && !inMaker && !(parent.type === 'BinaryExpression' && /^[!=]==$/.test(parent.operator)) && parent.type !== 'TSTypeQuery' && !(parent.type === 'VariableDeclarator' && parent.id === n))
      problems.push(`${HOME} hands out ${n.name} outside mint (${show(text, n)}): only compare with it`)
    if (n.type === 'ExportNamedDeclaration') {
      const fns = n.declaration?.type === 'FunctionDeclaration' ? [n.declaration] : (n.declaration?.declarations ?? []).map((d: Node) => d.init).filter((f: Node | null) => f && isFunction(f))
      for (const f of fns) if (said(f.returnType)) problems.push(`${HOME} exports a function that returns a person (${show(text, f)}): only mint makes one`)
    }
  })
  return problems
}

/** How `file` reaches the rule's modules: by named imports only (no `import * as`, default, re-export, `import()`, `require` or glob). */
const reaches = new Map<string, string[]>()
function reachProblems(file: string, text: string): string[] {
  const key = `${file}\0${text}`
  if (reaches.has(key)) return reaches.get(key)!
  const problems: string[] = []
  const rule = (spec: unknown) => typeof spec === 'string' && spec.startsWith('.') && RULE_MODULES.includes(normalize(join(dirname(file), spec)).replace(/\.(tsx?|js)$/, ''))
  const say = (n: Node, how: string) => problems.push(`${file} reaches the rule ${how} (${show(text, n)}): import its functions by name, so each call is a call by name`)
  if (/\b(import|export|require)\b/.test(text))
    visit(parse(file, text).program, (n) => {
      if (n.type === 'ImportDeclaration' && rule(n.source.value) && n.specifiers.some((x: Node) => x.type !== 'ImportSpecifier')) say(n, 'by a namespace or default import')
      if ((n.type === 'ExportAllDeclaration' || n.type === 'ExportNamedDeclaration') && rule(n.source?.value)) say(n, 'by a re-export')
      if (n.type === 'ImportExpression' && (n.source.type === 'Literal' ? rule(n.source.value) : !COMPUTED_IMPORTS[file])) say(n, n.source.type === 'Literal' ? 'by import()' : 'by import() of a computed path (or list it in COMPUTED_IMPORTS with why)')
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require') say(n, 'by require')
      if (n.type === 'MetaProperty' || (n.type === 'MemberExpression' && n.object.type === 'MetaProperty' && n.property.name === 'glob')) if (n.type === 'MemberExpression') say(n, 'by import.meta.glob')
    })
  reaches.set(key, problems)
  return problems
}

function judge(src: Record<string, string>) {
  const problems: string[] = []
  const helpers: Record<string, number> = {}
  for (const [file, text] of Object.entries(src)) if (!INSIDE.has(file) && file !== SOURCE && !parse(file, text).errors.length) Object.assign(helpers, factsOf(file, text).helpers)
  const helpersKey = JSON.stringify(helpers)
  for (const [file, text] of Object.entries(src)) {
    const {errors} = parse(file, text)
    if (errors.length) {
      problems.push(`${file} does not parse: ${errors[0]!.message}`)
      continue
    }
    if (file === HOME) continue
    const c = code(text)
    if (/persons\.fixture/.test(c) && file !== TEST_PEOPLE) problems.push(`${file} imports the tests' people (${TEST_PEOPLE}): take the person from lib/session.ts`)
    if (file === TEST_PEOPLE) continue
    if (file !== SOURCE && /\b(takeMint|giveMintBack|currentUserOf)\b/.test(c)) problems.push(`${file} makes a person from whoAmI itself: take it from ${SOURCE} (useCurrentUser, personOf)`)
    if (/\bUNKNOWN\b/.test(c) && /from '[./]*(lib\/)?conditions(\.ts)?'/.test(c)) problems.push(`${file} reads UNKNOWN itself: ask lib/conditions.ts (a rule's answer)`)
    if (!RULE_MODULES.some((m) => file.startsWith(`${m}.`))) problems.push(...reachProblems(file, text))
    if (!INSIDE.has(file) && file !== SOURCE) problems.push(...siteProblems(file, text, helpers, helpersKey))
    const readsRole = /\bmeQuery\b|\bwhoAmI\b/.test(c) && /\bme\??\.role\b/.test(c)
    if (readsRole && !READS_ROLE[file]) problems.push(`${file} reads whoAmI's role: ask currentUserOf (lib/conditions.ts), or list it in person-scan.test.ts with how it waits while unknown`)
  }
  for (const [file, {waits}] of Object.entries(READS_ROLE))
    if (!(file in src)) problems.push(`${file} is listed and gone`)
    else if (!waits.test(code(src[file]!).replace(/\s+/g, ' '))) problems.push(`${file} reads the role and no longer waits while unknown: ${waits}`)
  problems.push(...whoAmIProblems(src[SESSION] ?? ''))
  // The maker's one taker: once, at load, in a module the server loads once.
  const source = code(src[SOURCE] ?? '')
  if (!/^const currentUserOf = takeMint\(\)$/m.test(source) || /\bcreateServerFn\b/.test(source)) problems.push(`${SOURCE}: no longer takes the maker once as it loads, in a module with no server function`)
  // At home: a Person is sealed, nobody and the seal stay in the file, and unknown is UNKNOWN.
  const home = code(src[HOME] ?? '')
  if (!/export type Person = Known \| typeof NOBODY \| typeof UNKNOWN\b/.test(home) || !/^declare const sealed: unique symbol$/m.test(home) || !/^const NOBODY: unique symbol = Symbol\('nobody'\)$/m.test(home) || !/^const UNKNOWN: unique symbol = Symbol\('unknown'\)$/m.test(home) || /\bexport\s*\{[^}]*\b(NOBODY|UNKNOWN|sealed|Known|mint|minted|checked)\b/.test(home) || /\bexport\s+type\s+Known\b/.test(home))
    problems.push(`${HOME}: Person is no longer sealed (known, NOBODY or UNKNOWN, the markers, the seal and the maker kept in the file)`)
  problems.push(...sealProblems(src[HOME] ?? ''))
  if (!/if \(!me \|\| me\.provisional \|\| me\.unchecked\) return UNKNOWN/.test(home)) problems.push(`${HOME}: mint no longer says UNKNOWN for a check not answered`)
  if (/\bexport\s+(const|function)\s+personKnown\b/.test(home)) problems.push(`${HOME} exports personKnown: only it asks whether the person is known`)
  for (const [file, re] of Object.entries(BANNER)) if (!re.test(code(src[file] ?? '').replace(/\s+/g, ' '))) problems.push(`${file}: the failed check is no longer said only where something is closed: ${re}`)
  return problems
}

test('no reader treats an unknown person as nobody', () => {
  assert.deepEqual(judge(tree()), [])
})

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const fails = (src: Record<string, string>, file: string, text: string, why: RegExp) => assert.match(judge({...src, [file]: text}).join('\n'), why, file)
/** `src` with the `nth` (0-based) `from` in `file` made `to`; the fixture must still hold it. */
function swap(src: Record<string, string>, file: string, from: string, to: string, nth = 0) {
  let at = -1
  for (let i = 0; i <= nth; i++) at = src[file]!.indexOf(from, at + 1)
  assert.ok(at >= 0, `${file} holds ${from} (${nth})`)
  return {...src, [file]: src[file]!.slice(0, at) + to + src[file]!.slice(at + from.length)}
}
const red = (src: Record<string, string>, why: RegExp) => assert.match(judge(src).join('\n'), why)
const TAKEN = 'const user = useCurrentUser()'
const WHO = ['lib/who.ts', "import type {Person} from './conditions'\nexport const orNobody = (p: Person) => (typeof p === 'string' ? null : p)\n"] as const

test('fails cases: UNKNOWN or the role read outside conditions.ts, a person made outside session.ts, the seal opened, whoAmI past meOf', () => {
  const src = tree()
  fails(src, 'components/Badge.tsx', "import {UNKNOWN} from '../lib/conditions'\nexport const b = (user: unknown) => (user === UNKNOWN ? null : user)\n", /Badge\.tsx reads UNKNOWN itself/)
  fails(src, 'components/Role.tsx', "const me = useQuery(meQuery).data\nexport const admin = me?.role === 'admin'\n", /Role\.tsx reads whoAmI's role/)
  fails(src, 'components/Who.tsx', "import {takeMint} from '../lib/conditions'\nexport const who = takeMint()\n", /Who\.tsx makes a person from whoAmI itself/)
  red(swap(src, SOURCE, 'const currentUserOf = takeMint()', 'const currentUserOf = (me: never) => takeMint()(me)'), /person-source\.ts: no longer takes the maker once as it loads/)
  red({...src, [SOURCE]: `${src[SOURCE]!}\nexport const late = createServerFn({method: 'GET'}).handler(async () => 1)\n`}, /person-source\.ts: no longer takes the maker once as it loads, in a module with no server function/)
  fails(src, 'components/Broken.tsx', 'export const = 1\n', /Broken\.tsx does not parse/)
  red(swap(src, HOME, 'if (!me || me.provisional || me.unchecked) return UNKNOWN', 'if (!me || me.provisional) return UNKNOWN'), /mint no longer says UNKNOWN/)
  red(swap(src, HOME, 'const NOBODY: unique symbol', 'export const NOBODY: unique symbol'), /Person is no longer sealed/)
  red(swap(src, HOME, 'export type Person = Known | typeof NOBODY | typeof UNKNOWN', 'export type Person = CurrentUser | null | typeof UNKNOWN'), /Person is no longer sealed/)
  red(swap(src, HOME, 'const personKnown =', 'export const personKnown ='), /exports personKnown/)
  // A second maker in conditions.ts.
  const more = (line: string) => ({...src, [HOME]: `${src[HOME]!}\n${line}\n`})
  red(more('export const nobodyHere = (): Person => NOBODY'), /exports a function that returns a person[\s\S]*hands out NOBODY outside mint/)
  red(more('export const asPerson = (u: CurrentUser) => u as Known'), /casts to the person outside mint/)
  red(swap(src, HOME, 'const UNKNOWN: unique symbol', 'export const UNKNOWN: unique symbol'), /Person is no longer sealed/)
  red(more('export const none = () => [NOBODY][0]'), /hands out NOBODY outside mint \(line \d+: export const none/)
  red(more('export function maybe(p: CurrentUser): Person | undefined {\n  return undefined\n}'), /exports a function that returns a person/)
  fails(src, 'components/People.tsx', "import {nobody} from '../lib/persons.fixture'\nexport const p = nobody\n", /People\.tsx imports the tests' people/)
  red(swap(src, 'components/Diagnostics.tsx', 'me && !me.provisional && !me.unchecked ? (me.role', 'me ? (me.role'), /Diagnostics\.tsx reads the role and no longer waits/)
  // whoAmI's answer made inline, or meOf's changed on the way out.
  red(swap(src, SESSION, 'const me = meOf({', 'const me = ({unchecked: false, '), /whoAmI's answer is no longer meOf's/)
  red(swap(src, SESSION, 'return stand && !stand.seated ? {...me, email: stand.email, noSeat: true} : me', 'return {...me, unchecked: false}'), /whoAmI's answer is no longer meOf's/)
  // The failed check said on a doc with nothing closed.
  red(swap(src, 'components/DocumentPane.tsx', 'ruled={roleRuled(doc._type, studio.form?.conditions)}', 'ruled={true}'), /DocumentPane\.tsx: the failed check is no longer said only where something is closed/)
  red(swap(src, 'components/PersonCheckBanner.tsx', 'if (!bannerShows({failed, ruled, kept: keptAt !== null})) return null', 'if (!failed) return null'), /PersonCheckBanner\.tsx: the failed check is no longer said only where something is closed/)
})

test('fails cases: the reviewer\'s ways round, at the real lock sites (B1-B6), each caught by the scan itself', () => {
  const src = tree()
  const withWho = {...src, [WHO[0]]: WHO[1]}
  const F = 'components/Fields.tsx'
  const DP = 'components/DocumentPane.tsx'
  // B1, the form: `let`, then unknown turned into nobody.
  red(swap(src, F, TAKEN, "let u = useCurrentUser()\n  if (u === 'unknown') u = null\n  const user = u", 0), /Fields\.tsx takes the person another way \(line \d+: let u = useCurrentUser\(\)/)
  // B2, Paste document: a helper wraps the source.
  red(swap(withWho, 'components/DocHeaderMenu.tsx', TAKEN, 'const user = orNobody(useCurrentUser())'), /DocHeaderMenu\.tsx takes the person another way \(line \d+: const user = orNobody\(useCurrentUser\(\)\)/)
  // B3, Paste field: the source in brackets, then String().
  red(swap(src, F, TAKEN, "const p = (useCurrentUser())\n  const user = String(p) === 'unk' + 'nown' ? null : p", 1), /Fields\.tsx takes the person another way \(line \d+: const p = \(useCurrentUser\(\)\)/)
  // B4, the canvas and the save: destructured and mapped.
  red(swap(withWho, DP, TAKEN, 'const [user] = [useCurrentUser()].map(orNobody)', 0), /DocumentPane\.tsx takes the person another way \(line \d+: const \[user\]/)
  // B5, the page overlay: mapped.
  red(swap(withWho, 'lib/presentation-overlay.ts', 'const person = personOf(qc)', 'const person = [personOf(qc)].map(orNobody)[0]!'), /presentation-overlay\.ts takes the person another way/)
  // B6, the group tabs: in an object.
  red(swap(src, DP, TAKEN, "const box = {p: useCurrentUser()}\n  const user = box.p === 'unknown' ? null : box.p", 1), /DocumentPane\.tsx takes the person another way \(line \d+: const box = \{p: useCurrentUser\(\)\}/)
  // The helper itself reads its person.
  red(withWho, /who\.ts reads the person p \(line 2: .*typeof p/)
  // Round 1's: personKnown asked at the site, at each lock site, the second site in a file too.
  const asked = 'const user0 = useCurrentUser()\n  const user = personKnown(user0) ? user0 : null'
  for (const [file, n] of [[F, 0], [F, 1], ['components/DocHeaderMenu.tsx', 0], [DP, 0], [DP, 1]] as const) red(swap(src, file, TAKEN, asked, n), new RegExp(`${esc(file)} reads the person user0 \\(line \\d+: const user = personKnown\\(user0\\)`))
})

test('fails cases: what a rule call is handed, and how the person goes on', () => {
  const src = tree()
  const F = 'components/Fields.tsx'
  const DP = 'components/DocumentPane.tsx'
  const HM = 'components/DocHeaderMenu.tsx'
  // `any` values without the word: past tsc, not past the rule call.
  red(swap(src, F, 'fieldState(type, props.field, doc, user,', "fieldState(type, props.field, doc, JSON.parse('null'),"), /Fields\.tsx hands fieldState a person not taken from lib\/session\.ts \(line \d+: .*JSON\.parse/)
  red(swap(src, DP, 'fieldState(schema.name, f, doc, user,', 'fieldState(schema.name, f, doc, structuredClone(user),'), /DocumentPane\.tsx hands fieldState a person not taken from lib\/session\.ts \(line \d+: .*structuredClone/)
  const loose = {...src, 'lib/loose.js': 'export const loose = (p) => p && null\n'}
  red(swap(loose, 'lib/presentation-overlay.ts', 'pathReadOnly(type, schema.fields, doc, person,', 'pathReadOnly(type, schema.fields, doc, loose(person),'), /presentation-overlay\.ts hands pathReadOnly a person not taken from lib\/session\.ts/)
  red(swap(src, DP, 'fieldState(schema.name, f, doc, user,', 'fieldState(schema.name, f, doc, user ? user : user,'), /DocumentPane\.tsx hands fieldState a person not taken/)
  // The rule reached another way than a named import (B8b, B8c, B8f), or a rule function not called by its name.
  const ns = (s: Record<string, string>) => swap(s, F, "import {useCurrentUser} from '../lib/person-source'", "import {useCurrentUser} from '../lib/person-source'\nimport * as C from '../lib/conditions'")
  const beside = (call: string) => swap(ns(src), F, '    return s ? (s.hidden ? 1 : 0) | (s.readOnly ? 2 : 0) : 0', `    const t = doc && ${call}(type, props.field, doc, JSON.parse('null'), studio.form?.conditions, {path: props.path, value: props.value, parent})\n    return s && t ? (t.hidden ? 1 : 0) | (t.readOnly ? 2 : 0) : 0`)
  for (const call of ["C['fieldState']", 'C[`fieldState`]', 'C.fieldState.call', 'C.fieldState']) red(beside(call), /Fields\.tsx reaches the rule by a namespace or default import \(line \d+: import \* as C from '\.\.\/lib\/conditions'\)/)
  red(swap(src, F, '    return s ? (s.hidden ? 1 : 0) | (s.readOnly ? 2 : 0) : 0', "    const t = doc && fieldState.call(undefined, type, props.field, doc, JSON.parse('null'), studio.form?.conditions, {path: props.path, value: props.value, parent})\n    return s && t ? (t.hidden ? 1 : 0) | (t.readOnly ? 2 : 0) : 0"), /Fields\.tsx uses fieldState as a value \(line \d+: const t = doc && fieldState\.call/)
  fails(src, 'lib/rules-again.ts', "export * from './conditions'\n", /rules-again\.ts reaches the rule by a re-export/)
  fails(src, 'lib/rules-again.ts', "export {fieldState} from './conditions.ts'\n", /rules-again\.ts reaches the rule by a re-export/)
  fails(src, 'lib/rules-late.ts', "export const late = () => import('./form-lock')\n", /rules-late\.ts reaches the rule by import\(\)/)
  fails(src, 'lib/rules-late.ts', "export const late = (m: string) => import(`./${m}`)\n", /rules-late\.ts reaches the rule by import\(\) of a computed path/)
  fails(src, 'lib/rules-late.ts', "export const late = () => require('./paste-reads')\n", /rules-late\.ts reaches the rule by require/)
  fails(src, 'lib/rules-late.ts', "export const late = import.meta.glob('./*.ts')\n", /rules-late\.ts reaches the rule by import\.meta\.glob/)
  // Around the type: as, any, @ts-.
  red(swap(src, DP, 'keptEditsWait(user)', 'keptEditsWait(user as never)'), /DocumentPane\.tsx writes `as` on a line with the person/)
  red(swap(src, HM, TAKEN, `${TAKEN}\n  const any0: any = user`), /DocHeaderMenu\.tsx writes `any` on a line with the person/)
  red(swap(src, F, '    const s = doc && fieldState(type, props.field, doc, user,', '    // @ts-ignore\n    const s = doc && fieldState(type, props.field, doc, user,'), /Fields\.tsx writes `@ts-` on or above a line with the person/)
  // Put in an object or a ref, handed to something else, or the rule function itself passed on.
  red(swap(src, HM, 'pasteDocumentWith(qc, schema.fields, values, user, {type: schema.name, doc,', 'pasteDocumentWith(qc, schema.fields, values, user, {type: schema.name, doc, user,'), /DocHeaderMenu\.tsx reads the person user \(line \d+: .*pasteDocumentWith\(/)
  red(swap(src, DP, TAKEN, `${TAKEN}\n  const held = useRef(user)`, 1), /DocumentPane\.tsx reads the person user \(line \d+: const held = useRef\(user\)/)
  red(swap(src, DP, TAKEN, `${TAKEN}\n  const ask = fieldState`, 1), /DocumentPane\.tsx uses fieldState as a value/)
  // A function taking a Person: named, its callers held as a rule's; with no name, refused.
  const helped = {...src, 'lib/kept-wait.ts': "import {keptEditsWait, type Person} from './conditions'\nexport function waitsFor(p: Person) {\n  return keptEditsWait(p)\n}\n"}
  const imported = swap(helped, DP, "import {useRevealed} from '../lib/reveal'", "import {useRevealed} from '../lib/reveal'\nimport {waitsFor} from '../lib/kept-wait'")
  assert.deepEqual(judge(swap(imported, DP, 'keptEditsWait(user)', 'waitsFor(user)')), [])
  red(swap(imported, DP, 'keptEditsWait(user)', "waitsFor(JSON.parse('null'))"), /DocumentPane\.tsx hands waitsFor a person not taken/)
  fails(src, 'lib/each.ts', "import {keptEditsWait, type Person} from './conditions'\nexport const each = (ps: Person[]) => ps.map((p: Person) => keptEditsWait(p))\n", /each\.ts takes a Person in a function with no name/)
})

test('must pass: the person in a hook\'s dependency list (the group tabs, as the reviewer wrote it)', () => {
  const src = tree()
  const DP = 'components/DocumentPane.tsx'
  const deps = swap(src, DP, `${TAKEN}\n  if (!schema.groups?.length) return null`, `${TAKEN}\n  const rules = useMemo(() => studio.form?.conditions, [user])\n  if (!schema.groups?.length) return null`)
  assert.deepEqual(judge(swap(deps, DP, 'fieldState(schema.name, f, doc, user, studio.form?.conditions)', 'fieldState(schema.name, f, doc, user, rules)')), [])
})
