// task-4ffed14fbf52dc47: the person is one of three, known, nobody, or unknown (lib/conditions.ts
// Person), and no reader treats unknown as nobody. The first wall is the rule itself: it believes
// only a person made by the maker handed out now (conditions.ts checked), and reads anything else,
// a copy, a clone, null, any `any`, a person from a maker handed back, as unknown, so the field
// locks. The maker is handed out once (takeMint), to lib/person-source.ts; one handed back (a dev
// reload only: a build has no give-back) throws, and nothing it made is believed. The second wall is the type: a Person is sealed, so a lock
// site cannot write a nobody or a compare-and-replace that tsc takes. This scan is the third,
// read from the parse (oxc, source-tree.fixture.ts) of every file but the tests:
// - only lib/person-source.ts imports takeMint or giveMintBack (by import binding, so an escaped
//   or renamed name is caught; it holds no server function, so the server never loads it twice:
//   TanStack Start loads a module with server functions twice), and the tests' people
//   (persons.fixture.ts) are imported by no source file;
// - whoAmI's answer is written only in lib/session.ts: elsewhere meQuery is only asked
//   (useQuery, ensureQueryData, fetchQuery, prefetchQuery) and its key only read or refreshed,
//   never set, spread into a query of its own or given another queryFn; setQueriesData names its
//   key; a query client is made only where CLIENTS says, and personOf reads only the page's own
//   (router.tsx hands it over once: holdAppClient); no query's state is set past the client
//   (setData, setState, a cache's build), and setQueryData's key names a plain head;
// - only an answer the session made is believed: person-source.ts asks madeBySession, and
//   lib/me-query.ts registers only in whoAmI's queryFn in the browser, in a closure no module
//   exports (meQueryOf, taken only by session.ts); routes/__root.tsx asks again after load where a
//   role rule waits. A write the scan misses still gives unknown at run time (person-forged.test.ts);
// - person-source.ts and me-query.ts, like the rule's modules, are reached only by named imports;
// - a lock site takes the person one way: the whole initializer of a `const <name>`, from
//   `useCurrentUser()` or `personOf()`; a named function may take it as a parameter typed Person;
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
// is for the unit tests to catch. A write to whoAmI's key through a key computed elsewhere (a
// variable holding ['me'] made in another file, a whole cache copied) is not seen by name. And a known person minted before a check failed is still a
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
/** Reached only by named imports: the rule's modules, the person's source and who-am-I's query. */
const RULE_MODULES = ['lib/conditions', 'lib/form-lock', 'lib/paste-reads', 'lib/paste-locked', 'lib/person-source', 'lib/me-query']
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
  'components/PersonCheckBanner.tsx': /if \(!bannerShows\(\{failed, ruled, kept: ruled && keptAt !== null\}\)\) return null/,
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

  // The people: a `const` taken from lib/person-source.ts, or a named function's parameter typed Person.
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
      const plain = args?.length === 0
      if (plain && decl?.type === 'VariableDeclarator' && decl.init === call && decl.id.type === 'Identifier' && list?.type === 'VariableDeclaration' && list.kind === 'const') names.add(decl.id.name), binds.add(decl.id)
      else problems.push(`${file} takes the person another way (${show(text, n)}): only \`const <name> = useCurrentUser()\` or \`const <name> = personOf()\``)
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
      if (arg?.type !== 'Identifier' || !names.has(arg.name)) problems.push(`${file} hands ${calleeName(n)} a person not taken from ${SOURCE} (${show(text, arg ?? n)}): a \`const\` from useCurrentUser() or personOf(qc), or a parameter typed Person`)
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
const SEALED = /\b(Known|Nobody|Person|sealed)\b/
function sealProblems(text: string): string[] {
  const problems: string[] = []
  const {program} = parse(HOME, text)
  const said = (n: Node | undefined) => !!n && SEALED.test(text.slice(n.start, n.end))
  visit(program, (n, up) => {
    // mint makes a person; checked makes anything it did not unknown.
    const inMaker = up.some((u) => (u.type === 'FunctionDeclaration' && u.id?.name === 'mint') || (u.type === 'VariableDeclarator' && u.id.name === 'checked'))
    if ((n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSTypeAssertion') && said(n.typeAnnotation) && !inMaker) problems.push(`${HOME} casts to the person outside mint (${show(text, n.typeAnnotation)})`)
    const parent = up.at(-1)!
    if (n.type === 'Identifier' && n.name === 'UNKNOWN' && !inMaker && !(parent.type === 'BinaryExpression' && /^[!=]==$/.test(parent.operator)) && parent.type !== 'TSTypeQuery' && !(parent.type === 'VariableDeclarator' && parent.id === n))
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

/** Who may hold the maker and the page's client, by import binding: the maker, only SOURCE (and the tests' people); holdAppClient, only router.tsx. */
const ME_HOME = 'lib/me-query.ts'
/** The names a module exports (any `export`), read from the parse. */
const exportsOf = (file: string, text: string) =>
  parse(file, text).program.body.flatMap((n: Node): string[] =>
    n.type === 'ExportNamedDeclaration'
      ? n.declaration
        ? n.declaration.type === 'VariableDeclaration'
          ? n.declaration.declarations.map((d: Node) => d.id.name ?? '?')
          : [n.declaration.id?.name ?? '?']
        : n.specifiers.map((x: Node) => x.exported.name ?? x.exported.value)
      : n.type === 'ExportDefaultDeclaration' ? ['default'] : n.type === 'ExportAllDeclaration' || n.type === 'TSExportAssignment' ? ['*'] : [],
  )
const HANDS: Record<string, string[]> = {takeMint: [SOURCE, TEST_PEOPLE], giveMintBack: [SOURCE, TEST_PEOPLE], holdAppClient: ['router.tsx'], meQueryOf: [SESSION]}
/** Where a query client may be made, and why none of them is a way to a person (personOf reads only the page's own, useCurrentUser the provider's). */
const CLIENTS: Record<string, string> = {
  'router.tsx': "the page's own client, held for personOf",
  'lib/ssr-budget.ts': "a server render's scratch read, copied into the request's client",
  'lib/structure-route.tsx': "a server render's scratch reads for the pane chain",
}
/** Where whoAmI's query may be handed on, and why: */
const ME_HANDED: Record<string, {to: string; why: string}> = {'lib/structure-route.tsx': {to: 'withinBudget', why: "a server render reads whoAmI within 600 ms, else provisionalMe's stand-in (an unknown person)"}}
const READS = new Set(['getQueryData', 'getQueryState'])
const REFRESHES = new Set(['invalidateQueries', 'refetchQueries', 'cancelQueries'])
const RUNS = new Set(['ensureQueryData', 'fetchQuery', 'prefetchQuery'])
const hands = new Map<string, string[]>()
/** The maker, the page's client, whoAmI's cached answer: none reached but the one way. */
function handProblems(file: string, text: string): string[] {
  const key = `${file}\0${text}`
  if (hands.has(key)) return hands.get(key)!
  const problems: string[] = []
  const say = (n: Node, what: string) => problems.push(`${file} ${what} (${show(text, n)})`)
  const member = (n: Node | undefined) => (n?.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed ? (n.callee.property.name as string) : undefined)
  const called = (n: Node | undefined) => (n?.type === 'CallExpression' && n.callee.type === 'Identifier' ? (n.callee.name as string) : member(n))
  // The me key, read or refreshed only: an argument of a read, or the queryKey of a refresh's filter.
  const keyRead = (n: Node, up: readonly Node[], at: number) => {
    const [parent, grand, call] = [up[at - 1], up[at - 2], up[at - 3]]
    if (parent?.type === 'CallExpression' && parent.arguments[0] === n && READS.has(member(parent) ?? '')) return true
    return parent?.type === 'Property' && parent.value === n && parent.key.name === 'queryKey' && grand?.type === 'ObjectExpression' && call?.type === 'CallExpression' && call.arguments[0] === grand && REFRESHES.has(member(call) ?? '')
  }
  if (/\b(takeMint|giveMintBack|holdAppClient|meQueryOf|QueryClient|meQuery|me|setQueryData|setData|setState|getQueryCache)\b/.test(text))
    visit(parse(file, text).program, (n, up) => {
      const parent = up.at(-1)
      if (n.type === 'ImportSpecifier' && Object.hasOwn(HANDS, n.imported.name ?? n.imported.value) && !HANDS[n.imported.name ?? n.imported.value]!.includes(file)) say(n, `takes ${n.imported.name ?? n.imported.value}: a person comes only from ${SOURCE}`)
      if (n.type === 'ExportSpecifier' && Object.hasOwn(HANDS, n.local.name ?? n.local.value)) say(n, `passes ${n.local.name ?? n.local.value} on: a person comes only from ${SOURCE}`)
      // A query's state written past the client (a query found in the cache, set directly).
      if ((member(n) === 'setData' || (member(n) === 'setState' && n.callee.object.type !== 'ThisExpression') || (member(n) === 'build' && /getQueryCache/.test(show(text, n)))) && file !== SESSION) say(n, "writes a query's state directly: only through the client, by a key it names")
      // setQueryData's key, written out: its head a plain string, never whoAmI's, never computed.
      if (member(n) === 'setQueryData' && n.arguments[0]?.type === 'ArrayExpression') {
        const head = n.arguments[0].elements[0]
        if (head?.type !== 'Literal' || typeof head.value !== 'string' || head.value === 'me') say(n, "writes a query by a key whose head is not a plain name (whoAmI's?)")
      }
      if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'QueryClient' && !CLIENTS[file]) say(n, 'makes a query client: personOf reads only the page\'s own (list it in CLIENTS with why)')
      if (n.type === 'Identifier' && n.name === 'QueryClientProvider' && parent?.type !== 'ImportSpecifier') say(n, 'provides a query client of its own: useCurrentUser reads the page\'s')
      if (n.type === 'Identifier' && n.name === 'meQuery' && file !== SESSION && file !== ME_HOME && parent && !isKey(n, parent) && parent.type !== 'ImportSpecifier') {
        const asQuery = parent.type === 'CallExpression' && parent.arguments[0] === n && (called(parent) === 'useQuery' || RUNS.has(member(parent) ?? ''))
        const asKey = parent.type === 'MemberExpression' && parent.object === n && !parent.computed && parent.property.name === 'queryKey' && keyRead(parent, up, up.length - 1)
        const handed = parent.type === 'CallExpression' && ME_HANDED[file]?.to === called(parent)
        if (!asQuery && !asKey && !handed) say(n, "writes or reshapes whoAmI's answer: only useQuery(meQuery), ensureQueryData/fetchQuery/prefetchQuery(meQuery), or meQuery.queryKey read or refreshed")
      }
      // whoAmI's key itself (['me']; a list of key heads, like SessionGate's KEEP, is no key).
      if (n.type === 'ArrayExpression' && n.elements.length === 1 && n.elements[0]?.type === 'Literal' && n.elements[0].value === 'me' && file !== SESSION && file !== ME_HOME && !keyRead(n, up, up.length)) say(n, "names whoAmI's key to write it: only read it, or refresh it")
      // Writes to many queries: each names its key's head, never whoAmI's, and no predicate.
      if (member(n) === 'setQueriesData') {
        const filter = n.arguments[0]
        const key = filter?.type === 'ObjectExpression' ? filter.properties.find((p: Node) => p.type === 'Property' && p.key.name === 'queryKey')?.value : undefined
        const head = key?.type === 'ArrayExpression' ? key.elements[0] : undefined
        const others = filter?.type === 'ObjectExpression' ? filter.properties.some((p: Node) => p.type !== 'Property' || p.key.name === 'predicate') : true
        if (head?.type !== 'Literal' || typeof head.value !== 'string' || head.value === 'me' || others) say(n, "writes to queries it does not name (whoAmI's among them?): only {queryKey: ['<head>', ...]}")
      }
    })
  hands.set(key, problems)
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
    if (/persons\.fixture/.test(c) && file !== TEST_PEOPLE) problems.push(`${file} imports the tests' people (${TEST_PEOPLE}): take the person from ${SOURCE}`)
    if (file === TEST_PEOPLE) continue
    problems.push(...handProblems(file, text))
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
  // Believed: only an answer the session made; the page's client held once.
  if ((source.match(/currentUserOf\(madeBySession\(me\) \? me : undefined\)/g) ?? []).length !== 2 || /\bcurrentUserOf\((?!madeBySession\(me\) \? me : undefined\))/.test(source))
    problems.push(`${SOURCE}: makes a person from an answer the session may not have made (only currentUserOf(madeBySession(me) ? me : undefined))`)
  if (!/^  if \(appClient\) throw /m.test(source)) problems.push(`${SOURCE}: holds the page's client more than once`)
  // Believed: the latest ask's answer, set only in the browser in who-am-I's own queryFn (and kept
  // by an equal answer), cleared by a failed ask; the latest in no export.
  const query = code(src[ME_HOME] ?? '')
  const sets = (query.match(/\bcurrent = [^\n]*/g) ?? []).join('\n')
  if (sets !== "current = null\ncurrent = typeof window !== 'undefined' && typeof me === 'object' && me !== null ? frozen(me) : null\ncurrent = old" || !/^      if \(ask === asks\) current = typeof window/m.test(query) || !/^  const isMade = \(me: unknown\) => current !== null && me === current$/m.test(query) || !/^  return \{query, isMade\}$/m.test(query) || !/^      if \(!\(isMade\(next\) && before !== null && old === before && replaceEqualDeep\(old, next\) === old\)\) return next$/m.test(query))
    problems.push(`${ME_HOME}: registers an answer outside whoAmI's queryFn in the browser, or keeps one it did not make`)
  if (src[ME_HOME] !== undefined && exportsOf(ME_HOME, src[ME_HOME]!).join() !== 'meQueryOf,asksAgain') problems.push(`${ME_HOME} exports ${exportsOf(ME_HOME, src[ME_HOME]!).join(', ')}: only meQueryOf and asksAgain (the register stays in the closure)`)
  const session = code(src[SESSION] ?? '')
  if (!/^const asked = meQueryOf\(\(\) => whoAmI\(\)\)$/m.test(session) || !/^export const meQuery = asked\.query$/m.test(session) || !/^export const madeBySession = asked\.isMade$/m.test(session) || /\bexport\b[^\n]*\basked\b(?!\.(query|isMade)$)/m.test(session) || (session.match(/\basked\b/g) ?? []).length !== 3)
    problems.push(`${SESSION}: who-am-I's query is no longer meQueryOf(whoAmI)'s, or hands more of it on than meQuery and madeBySession`)
  if (!/asksAgain\(qc\.getQueryData\(meQuery\.queryKey\), madeBySession, studio\.form\?\.conditions\)\) void qc\.invalidateQueries\(\{queryKey: meQuery\.queryKey\}\)/.test(code(src['routes/__root.tsx'] ?? '')))
    problems.push('routes/__root.tsx no longer asks who-am-I again after load where a role rule waits (asksAgain)')
  // At home: a Person is sealed, nobody and the seal stay in the file, and unknown is UNKNOWN.
  const home = code(src[HOME] ?? '')
  if (!/export type Person = Known \| Nobody \| typeof UNKNOWN\b/.test(home) || !/^declare const sealed: unique symbol$/m.test(home) || !/^type Nobody = \{readonly \[sealed\]: 'nobody'\}$/m.test(home) || !/^const UNKNOWN: unique symbol = Symbol\('unknown'\)$/m.test(home) || /\bexport\s*\{[^}]*\b(UNKNOWN|sealed|Known|Nobody|mint|madeBy|nobodies|taken|checked)\b/.test(home) || /\bexport\s+(type\s+(Known|Nobody)|(let|const)\s+(taken|madeBy|nobodies))\b/.test(home))
    problems.push(`${HOME}: Person is no longer sealed (known, nobody or UNKNOWN; the marker, the seal and the maker kept in the file)`)
  problems.push(...sealProblems(src[HOME] ?? ''))
  if (!/if \(!me \|\| me\.provisional \|\| me\.unchecked\) return UNKNOWN/.test(home)) problems.push(`${HOME}: mint no longer says UNKNOWN for a check not answered`)
  if (!/^const DEV = import\.meta\.env\?\.DEV !== false$/m.test(home) || !/^export const giveMintBack = \(m: unknown\) => void \(DEV && m !== null && m === taken && \(taken = null\)\)$/m.test(home) || !/^    if \(maker !== taken\) throw /m.test(home) || !/madeBy\.get\(p\) === taken\)$/m.test(home))
    problems.push(`${HOME}: a maker is no longer stopped when handed back, or one is handed back in a build`)
  if (/\bexport\s+(const|function)\s+personKnown\b/.test(home)) problems.push(`${HOME} exports personKnown: only it asks whether the person is known`)
  for (const [file, re] of Object.entries(BANNER)) if (!re.test(code(src[file] ?? '').replace(/\s+/g, ' '))) problems.push(`${file}: the failed check is no longer said only where something is closed: ${re}`)
  return problems
}

test('no reader treats an unknown person as nobody', () => {
  assert.deepEqual(judge(tree()), [])
})

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
/** `src` with `file` made `text`: a plant. It prints the line it changed; a plant that changes nothing fails. */
function plant(src: Record<string, string>, file: string, text: string) {
  const was = src[file] ?? ''
  assert.notEqual(text, was, `${file}: the plant changes nothing`)
  const [a, b] = [was.split('\n'), text.split('\n')]
  let i = 0
  while (i < b.length && a[i] === b[i]) i++
  console.log(`plant ${file}:${i + 1}: ${b[i] ?? '(lines removed)'}`)
  return {...src, [file]: text}
}
const fails = (src: Record<string, string>, file: string, text: string, why: RegExp) => assert.match(judge(plant(src, file, text)).join('\n'), why, file)
/** `src` with the `nth` (0-based) `from` in `file` made `to`; the fixture must still hold it. */
function swap(src: Record<string, string>, file: string, from: string, to: string, nth = 0) {
  let at = -1
  for (let i = 0; i <= nth; i++) at = src[file]!.indexOf(from, at + 1)
  assert.ok(at >= 0, `${file} holds ${from} (${nth})`)
  return plant(src, file, src[file]!.slice(0, at) + to + src[file]!.slice(at + from.length))
}
const red = (src: Record<string, string>, why: RegExp) => assert.match(judge(src).join('\n'), why)
const TAKEN = 'const user = useCurrentUser()'
const WHO = ['lib/who.ts', "import type {Person} from './conditions'\nexport const orNobody = (p: Person) => (typeof p === 'string' ? null : p)\n"] as const

test('fails cases: UNKNOWN or the role read outside conditions.ts, a person made outside session.ts, the seal opened, whoAmI past meOf', () => {
  const src = tree()
  fails(src, 'components/Badge.tsx', "import {UNKNOWN} from '../lib/conditions'\nexport const b = (user: unknown) => (user === UNKNOWN ? null : user)\n", /Badge\.tsx reads UNKNOWN itself/)
  fails(src, 'components/Role.tsx', "const me = useQuery(meQuery).data\nexport const admin = me?.role === 'admin'\n", /Role\.tsx reads whoAmI's role/)
  fails(src, 'components/Who.tsx', "import {takeMint} from '../lib/conditions'\nexport const who = takeMint()\n", /Who\.tsx takes takeMint/)
  fails(src, 'components/Who.tsx', "import {take\\u004dint as t, giveMintBack as g} from '../lib/conditions'\nconst f = t()\ng(f)\n", /Who\.tsx takes takeMint[\s\S]*Who\.tsx takes giveMintBack/)
  fails(src, 'components/Who.tsx', "import {holdAppClient} from '../lib/person-source'\nimport {QueryClient} from '@tanstack/react-query'\nholdAppClient(new QueryClient())\n", /Who\.tsx takes holdAppClient[\s\S]*Who\.tsx makes a query client/)
  red(swap(src, SOURCE, 'const currentUserOf = takeMint()', 'const currentUserOf = (me: never) => takeMint()(me)'), /person-source\.ts: no longer takes the maker once as it loads/)
  red(plant(src, SOURCE, `${src[SOURCE]!}\nexport const late = createServerFn({method: 'GET'}).handler(async () => 1)\n`), /person-source\.ts: no longer takes the maker once as it loads, in a module with no server function/)
  fails(src, 'components/Broken.tsx', 'export const = 1\n', /Broken\.tsx does not parse/)
  red(swap(src, HOME, 'if (!me || me.provisional || me.unchecked) return UNKNOWN', 'if (!me || me.provisional) return UNKNOWN'), /mint no longer says UNKNOWN/)
  red(swap(src, HOME, "type Nobody = {readonly [sealed]: 'nobody'}", "export type Nobody = {readonly [sealed]: 'nobody'}"), /Person is no longer sealed/)
  red(swap(src, HOME, 'let taken: Maker', 'export let taken: Maker'), /Person is no longer sealed/)
  red(swap(src, HOME, 'export type Person = Known | Nobody | typeof UNKNOWN', 'export type Person = CurrentUser | null | typeof UNKNOWN'), /Person is no longer sealed/)
  red(swap(src, HOME, 'const personKnown =', 'export const personKnown ='), /exports personKnown/)
  // P1b: a maker taken early and handed back keeps working, or what it made is still believed, or a build hands back.
  red(swap(src, HOME, 'void (DEV && m !== null', 'void (m !== null'), /handed back, or one is handed back in a build/)
  red(swap(src, HOME, '    if (maker !== taken) throw ', '    if (maker === null) throw '), /no longer stopped when handed back/)
  red(swap(src, HOME, 'madeBy.get(p) === taken)', 'madeBy.has(p))'), /no longer stopped when handed back/)
  fails(src, 'components/Early.tsx', "import {takeMint, giveMintBack} from '../lib/conditions'\nconst forge = takeMint()\ngiveMintBack(forge)\nexport const admin = forge({email: 'a@b', name: 'a', userId: 'u', role: 'admin', canWrite: true})\n", /Early\.tsx takes takeMint[\s\S]*Early\.tsx takes giveMintBack/)
  // A second maker in conditions.ts.
  const more = (line: string) => plant(src, HOME, `${src[HOME]!}\n${line}\n`)
  red(more('export const unknownHere = (): Person => UNKNOWN'), /exports a function that returns a person[\s\S]*hands out UNKNOWN outside mint/)
  red(more('export const nobodyHere = () => ({}) as Nobody'), /casts to the person outside mint/)
  red(more('export const asPerson = (u: CurrentUser) => u as Known'), /casts to the person outside mint/)
  red(swap(src, HOME, 'const UNKNOWN: unique symbol', 'export const UNKNOWN: unique symbol'), /Person is no longer sealed/)
  red(more('export const none = () => [UNKNOWN][0]'), /hands out UNKNOWN outside mint \(line \d+: export const none/)
  red(more('export function maybe(p: CurrentUser): Person | undefined {\n  return undefined\n}'), /exports a function that returns a person/)
  fails(src, 'components/People.tsx', "import {nobody} from '../lib/persons.fixture'\nexport const p = nobody\n", /People\.tsx imports the tests' people/)
  red(swap(src, 'components/Diagnostics.tsx', 'me && !me.provisional && !me.unchecked ? (me.role', 'me ? (me.role'), /Diagnostics\.tsx reads the role and no longer waits/)
  // whoAmI's answer made inline, or meOf's changed on the way out.
  red(swap(src, SESSION, 'const me = meOf({', 'const me = ({unchecked: false, '), /whoAmI's answer is no longer meOf's/)
  red(swap(src, SESSION, 'return stand && !stand.seated ? {...me, email: stand.email, noSeat: true} : me', 'return {...me, unchecked: false}'), /whoAmI's answer is no longer meOf's/)
  // The failed check said on a doc with nothing closed.
  red(swap(src, 'components/DocumentPane.tsx', 'ruled={roleRuled(doc._type, studio.form?.conditions)}', 'ruled={true}'), /DocumentPane\.tsx: the failed check is no longer said only where something is closed/)
  red(swap(src, 'components/PersonCheckBanner.tsx', 'if (!bannerShows({failed, ruled, kept: ruled && keptAt !== null})) return null', 'if (!failed) return null'), /PersonCheckBanner\.tsx: the failed check is no longer said only where something is closed/)
})

test('fails cases: the reviewer\'s ways round, at the real lock sites (B1-B6), each caught by the scan itself', () => {
  const src = tree()
  const withWho = plant(src, WHO[0], WHO[1])
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
  red(swap(withWho, 'lib/presentation-overlay.ts', 'const person = personOf()', 'const person = [personOf()].map(orNobody)[0]!'), /presentation-overlay\.ts takes the person another way/)
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
  red(swap(src, F, 'fieldState(type, props.field, doc, user,', "fieldState(type, props.field, doc, JSON.parse('null'),"), /Fields\.tsx hands fieldState a person not taken from lib\/person-source\.ts \(line \d+: .*JSON\.parse/)
  red(swap(src, DP, 'fieldState(schema.name, f, doc, user,', 'fieldState(schema.name, f, doc, structuredClone(user),'), /DocumentPane\.tsx hands fieldState a person not taken from lib\/person-source\.ts \(line \d+: .*structuredClone/)
  const loose = {...src, 'lib/loose.js': 'export const loose = (p) => p && null\n'}
  red(swap(loose, 'lib/presentation-overlay.ts', 'pathReadOnly(type, schema.fields, doc, person,', 'pathReadOnly(type, schema.fields, doc, loose(person),'), /presentation-overlay\.ts hands pathReadOnly a person not taken from lib\/person-source\.ts/)
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
  // whoAmI's answer forged in a client (P4: a new one handed to personOf; P3: the page's own).
  red(swap(src, F, 'const user = useCurrentUser()', "const asked = new QueryClient()\n  asked.setQueryData(meQuery.queryKey, {unchecked: false, canWrite: true})\n  const user = personOf(asked)", 0), /Fields\.tsx makes a query client[\s\S]*Fields\.tsx writes or reshapes whoAmI's answer[\s\S]*Fields\.tsx takes the person another way \(line \d+: const user = personOf\(asked\)/)
  const PB = 'components/PersonCheckBanner.tsx'
  red(swap(src, PB, 'const me = useQuery(meQuery)', "const me = useQuery(meQuery)\n  qc.setQueryData(meQuery.queryKey, {...me.data, unchecked: false})"), /PersonCheckBanner\.tsx writes or reshapes whoAmI's answer[^\n]*\(line \d+: qc\.setQueryData\(meQuery\.queryKey/)
  red(swap(src, PB, 'const me = useQuery(meQuery)', "const me = useQuery(meQuery)\n  qc.setQueryData(['me'], {...me.data, unchecked: false})"), /PersonCheckBanner\.tsx names whoAmI's key to write it/)
  red(swap(src, PB, 'const me = useQuery(meQuery)', "const me = useQuery({...meQuery, queryFn: async () => ({unchecked: false})})"), /PersonCheckBanner\.tsx writes or reshapes whoAmI's answer/)
  red(swap(src, PB, 'const me = useQuery(meQuery)', "const me = useQuery({queryKey: meQuery.queryKey, queryFn: async () => ({unchecked: false})})"), /PersonCheckBanner\.tsx writes or reshapes whoAmI's answer/)
  // Round 5: the page's client handed over again, renamed or through a namespace (P5, P5b); a
  // query's data set directly (P6); whoAmI's key computed (P6b). Each also gives unknown at run
  // time (person-forged.test.ts): no answer but the session's is believed.
  fails(src, 'components/Keep.tsx', "export {holdAppClient as keepClient} from '../lib/person-source'\n", /Keep\.tsx passes holdAppClient on[\s\S]*Keep\.tsx reaches the rule by a re-export/)
  fails(src, 'components/Keep.tsx', "import {holdAppClient} from '../lib/person-source'\nexport {holdAppClient as keepClient}\n", /Keep\.tsx takes holdAppClient[\s\S]*Keep\.tsx passes holdAppClient on/)
  fails(src, 'components/Keep.tsx', "import * as PS from '../lib/person-source'\nimport {QueryClient} from '@tanstack/react-query'\nPS.holdAppClient({getQueryData: () => ({role: 'admin'})} as unknown as QueryClient)\n", /Keep\.tsx reaches the rule by a namespace or default import/)
  red(swap(src, PB, 'const me = useQuery(meQuery)', "const me = useQuery(meQuery)\n  qc.getQueryCache().getAll().find((q) => q.queryHash === '[\"m' + 'e\"]')?.setData({...me.data, unchecked: false})"), /PersonCheckBanner\.tsx writes a query's state directly/)
  red(swap(src, PB, 'const me = useQuery(meQuery)', "const me = useQuery(meQuery)\n  qc.setQueryData(['m' + 'e'], {...me.data, unchecked: false})"), /PersonCheckBanner\.tsx writes a query by a key whose head is not a plain name/)
  fails(src, 'components/Mint.tsx', "import {meQueryOf} from '../lib/me-query'\nexport const mine = meQueryOf(async () => ({role: 'admin'}))\n", /Mint\.tsx takes meQueryOf/)
  // The registration's pins: on the server or past the queryFn, a look-alike kept, the register
  // exported, session.ts handing on more, __root.tsx asking no more, the client held twice.
  red(swap(src, ME_HOME, "current = typeof window !== 'undefined' && typeof me === 'object' && me !== null ? frozen(me) : null", "current = typeof me === 'object' && me !== null ? frozen(me) : null"), /me-query\.ts: registers an answer outside whoAmI's queryFn in the browser/)
  red(swap(src, ME_HOME, '(isMade(next) && before !== null && old === before && replaceEqualDeep(old, next) === old)', '(isMade(next) && replaceEqualDeep(old, next) === old)'), /me-query\.ts: registers an answer outside[\s\S]*or keeps one it did not make/)
  red(swap(src, ME_HOME, '  const isMade = (me: unknown) => current !== null && me === current', '  const isMade = (me: unknown) => me === current || me === before'), /me-query\.ts: registers an answer outside/)
  red(swap(src, ME_HOME, '      if (ask === asks) current = typeof', '      current = typeof'), /me-query\.ts: registers an answer outside/)
  red(swap(src, ME_HOME, '  return {query, isMade}', '  return {query, isMade, made}'), /me-query\.ts: registers an answer outside/)
  red(swap(src, ME_HOME, 'export function meQueryOf', 'export const register = (s: WeakSet<object>, me: object) => s.add(me)\nexport function meQueryOf'), /me-query\.ts exports register, meQueryOf, asksAgain: only meQueryOf and asksAgain/)
  red(swap(src, SESSION, 'export const madeBySession = asked.isMade', 'export const madeBySession = asked.isMade\nexport const sessionQuery = asked'), /session\.ts: who-am-I's query is no longer meQueryOf\(whoAmI\)'s, or hands more of it on/)
  red(swap(src, SESSION, 'export const madeBySession = asked.isMade', 'export const madeBySession = (me: unknown) => !!me'), /session\.ts: who-am-I's query is no longer meQueryOf/)
  red(swap(src, 'routes/__root.tsx', 'asksAgain(qc.getQueryData(meQuery.queryKey), madeBySession, studio.form?.conditions)', 'qc.getQueryData<{provisional?: boolean}>(meQuery.queryKey)?.provisional'), /__root\.tsx no longer asks who-am-I again/)
  red(swap(src, SOURCE, '  if (appClient) throw ', '  if (!qc) throw '), /person-source\.ts: holds the page's client more than once/)
  red(swap(src, SOURCE, 'return currentUserOf(madeBySession(me) ? me : undefined)', 'return currentUserOf(me)'), /person-source\.ts: makes a person from an answer the session may not have made/)
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
