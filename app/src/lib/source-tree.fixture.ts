// The studio's source as the scans read it (fieldrule-scan, person-scan): every file under src/
// but the tests, and each one parsed by the parser Vite builds with (oxc, `parseSync`), kept per
// text. For the tests only: a fixture, so the runner does not run it as a test.
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseSync} from 'vite'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [join(dir, n)] : []))
/** Each source file's text, by its path under src/. */
export const tree = (): Record<string, string> => Object.fromEntries(files(SRC).map((f) => [relative(SRC, f), readFileSync(f, 'utf8')]))

export type Node = {type: string; start: number; end: number; [k: string]: any}
export type Parsed = {program: Node; comments: {type: string; value: string; start: number; end: number}[]; errors: {message: string}[]}
const parsed = new Map<string, Parsed>()
/** `text` parsed as `file` (TS, or TSX by its name): the tree, its comments and its errors. Kept by file and text: a scan reads most files many times. */
export function parse(file: string, text: string): Parsed {
  const key = `${file}\0${text}`
  if (!parsed.has(key)) parsed.set(key, parseSync(file, text, {lang: file.endsWith('.tsx') ? 'tsx' : 'ts'}) as never)
  return parsed.get(key)!
}
/** Each node under `n`, with the nodes above it (nearest last). */
export function visit(n: unknown, see: (node: Node, up: readonly Node[]) => void, up: Node[] = []): void {
  if (!n || typeof n !== 'object') return
  if (Array.isArray(n)) {
    for (const x of n) visit(x, see, up)
    return
  }
  if (typeof (n as Node).type !== 'string') return
  see(n as Node, up)
  up.push(n as Node)
  for (const k in n) {
    const v = (n as Node)[k]
    if (v && typeof v === 'object') visit(v, see, up)
  }
  up.pop()
}
/** The names a binding pattern binds (`const {a, b: c, ...d} = …` binds a, c and d). */
export const bound = (p: Node | null): string[] =>
  !p ? [] : p.type === 'Identifier' ? [p.name] : p.type === 'ObjectPattern' ? p.properties.flatMap((x: Node) => bound(x.type === 'RestElement' ? x : x.value)) : p.type === 'ArrayPattern' ? p.elements.flatMap(bound) : p.type === 'RestElement' ? bound(p.argument) : p.type === 'AssignmentPattern' ? bound(p.left) : p.type === 'TSParameterProperty' ? bound(p.parameter) : [`?${p.type}`]

