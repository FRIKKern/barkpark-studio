import type {Field} from './data'

// The code field (Sanity's @sanity/code-input 7.3): an object `{_type: 'code', language,
// filename, code, highlightedLines}` edited in a code editor with a language picker, an
// optional filename and line numbers that toggle a highlight. The stored shape is Sanity's
// to the letter, so a Sanity dataset's code fields and code blocks open here and ours there.
// Barkpark refuses an unknown field type, so the schema says it as a named object: a
// composite whose `namedType` is "code" (Barkpark stamps the same on a field of a
// registered object type named `code`), with the plugin's `options`. This file is the pure
// part: the shape, the languages, what a change writes, the highlighted lines, the preview
// and the diff. The editor is components/CodeInput.tsx.

export type CodeValue = {_type?: string; _key?: string; language?: string; filename?: string; code?: string; highlightedLines?: number[]}
export type CodeLanguage = {title: string; value: string; mode?: string}
export type CodeOptions = {language?: string; languageAlternatives?: CodeLanguage[]; withFilename?: boolean}

/** The plugin's language list, in its order and with its values (`golang`, `text`, `sh`). */
export const CODE_LANGUAGES: CodeLanguage[] = [
  {title: 'Batch file', value: 'batchfile'},
  {title: 'C#', value: 'csharp'},
  {title: 'CSS', value: 'css'},
  {title: 'Go', value: 'golang'},
  {title: 'GROQ', value: 'groq'},
  {title: 'HTML', value: 'html'},
  {title: 'Java', value: 'java'},
  {title: 'JavaScript', value: 'javascript'},
  {title: 'JSON', value: 'json'},
  {title: 'JSX', value: 'jsx'},
  {title: 'Markdown', value: 'markdown'},
  {title: 'MySQL', value: 'mysql'},
  {title: 'PHP', value: 'php'},
  {title: 'Plain text', value: 'text'},
  {title: 'Python', value: 'python'},
  {title: 'Ruby', value: 'ruby'},
  {title: 'SASS', value: 'sass'},
  {title: 'SCSS', value: 'scss'},
  {title: 'sh', value: 'sh'},
  {title: 'SQL', value: 'sql'},
  {title: 'TSX', value: 'tsx'},
  {title: 'TypeScript', value: 'typescript'},
  {title: 'XML', value: 'xml'},
  {title: 'YAML', value: 'yaml'},
]
/** The plugin's alias: a stored or declared `js` is `javascript`. */
const ALIASES: Record<string, string> = {js: 'javascript'}
/** The modes the editor can colour (CodeInput.tsx loads each on first use); any other is plain text. */
export const CODE_MODES = ['groq', 'javascript', 'jsx', 'typescript', 'tsx', 'php', 'sql', 'mysql', 'json', 'markdown', 'java', 'html', 'csharp', 'sh', 'css', 'scss', 'sass', 'ruby', 'python', 'xml', 'yaml', 'golang', 'text'] as const
export type CodeMode = (typeof CODE_MODES)[number]

/** The fields the object holds, as the plugin's schema names them (what Barkpark checks a value against). */
export const CODE_FIELDS: Field[] = [
  {name: 'language', title: 'Language', type: 'string'},
  {name: 'filename', title: 'Filename', type: 'string'},
  {name: 'code', title: 'Code', type: 'text'},
  {name: 'highlightedLines', title: 'Highlighted lines', type: 'arrayOf', of: {name: '', title: 'Highlighted line', type: 'number'}},
]

/** A field (or an array member) declared as the code object. */
export const isCodeField = (field: Pick<Field, 'type' | 'namedType'> | undefined): boolean => field?.type === 'composite' && field.namedType === 'code'

/**
 * A Portable Text block type that is the code object: named `code`, and its fields (where
 * the schema declares any) are the plugin's. Another object that only shares the name keeps
 * its own dialog.
 */
export const isCodeBlock = (name: string, fields?: Pick<Field, 'name'>[]): boolean => name === 'code' && (!fields?.length || fields.some((f) => f.name === 'code'))

/** A stored code object (Sanity's `_type: 'code'`), wherever it sits: a list row previews it by its first line. */
export const isCodeValue = (v: unknown): v is CodeValue => !!v && typeof v === 'object' && !Array.isArray(v) && (v as CodeValue)._type === 'code'

export function codeOptions(field: Pick<Field, 'options'> | {options?: unknown} | undefined): CodeOptions {
  const o = field?.options
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as CodeOptions) : {}
}

/** The picker's languages: the declared alternatives (an alias read as its language), else the plugin's list. */
export function codeLanguages(options: CodeOptions): CodeLanguage[] {
  const declared = options.languageAlternatives
  if (!Array.isArray(declared)) return CODE_LANGUAGES
  return declared.filter((l): l is CodeLanguage => !!l && typeof l === 'object' && typeof l.value === 'string').map((l) => ({title: l.title ?? l.value, value: ALIASES[l.value] ?? l.value, ...(l.mode ? {mode: l.mode} : {})}))
}

/**
 * The language the picker shows and the mode the editor colours it in: the stored language,
 * else `options.language`, else plain text; the mode is the alternative's `mode`, else the
 * language itself (an alias resolved), and plain text for one the editor does not know.
 */
export function codeLanguage(value: CodeValue | undefined, options: CodeOptions): {language: string; mode: CodeMode; languages: CodeLanguage[]} {
  const languages = codeLanguages(options)
  const stored = typeof value?.language === 'string' && value.language ? value.language : undefined
  const language = stored ?? (typeof options.language === 'string' && options.language ? options.language : 'text')
  const wanted = languages.find((l) => l.value === language)?.mode ?? ALIASES[language] ?? language
  return {language, mode: (CODE_MODES as readonly string[]).includes(wanted) ? (wanted as CodeMode) : 'text', languages}
}

/** A stored value read for the editor: its text and its highlighted lines (whole numbers from 1, as stored). */
export function codeOf(value: unknown): {code: string; lines: number[]} {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as CodeValue) : {}
  return {code: typeof v.code === 'string' ? v.code : '', lines: Array.isArray(v.highlightedLines) ? v.highlightedLines.filter((n) => Number.isInteger(n) && n >= 1) : []}
}

export type CodeChange = {code: string} | {language: string | undefined} | {filename: string | undefined} | {highlightedLines: number[]}
/**
 * What a change writes, subfield by subfield (each goes to its own path, so two editors on
 * the language and the code both keep theirs), as the plugin's patches: the object's
 * `_type` when it has none; with new code, the language the picker shows when none is
 * stored; emptied code, an emptied filename and "no language" are unset (undefined).
 */
export function codeWrites(value: CodeValue | undefined, change: CodeChange, options: CodeOptions, typeName = 'code'): [name: keyof CodeValue, value: unknown][] {
  const out: [keyof CodeValue, unknown][] = []
  if (value?._type !== typeName) out.push(['_type', typeName])
  if ('code' in change) {
    if (!value?.language) out.push(['language', codeLanguage(value, options).language])
    out.push(['code', change.code || undefined])
  } else if ('language' in change) out.push(['language', change.language || undefined])
  else if ('filename' in change) out.push(['filename', change.filename || undefined])
  else out.push(['highlightedLines', change.highlightedLines])
  return out
}

/** The object after a change, for a value that is saved whole (a Portable Text block's dialog). */
export function withCodeChange(value: CodeValue | undefined, change: CodeChange, options: CodeOptions, typeName = 'code'): CodeValue {
  const next: Record<string, unknown> = {...value}
  for (const [k, v] of codeWrites(value, change, options, typeName)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  return next as CodeValue
}

/** A click on a line number: the line highlighted or not, the list kept in line order. */
export function toggleLine(lines: number[], line: number): number[] {
  return lines.includes(line) ? lines.filter((n) => n !== line) : [...lines, line].sort((a, b) => a - b)
}

/** One replaced range of the text before an edit: [from, to) became `insert` characters. */
export type TextChange = {from: number; to: number; insert: number}

/** The one range that turns `before` into `after` (what is left between their common start and end). */
export function changeBetween(before: string, after: string): TextChange | null {
  if (before === after) return null
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let end = 0
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++
  return {from: start, to: before.length - end, insert: after.length - end - start}
}

/**
 * The highlighted lines after an edit, as the plugin moves them: a highlight follows its
 * line's content (a line added above pushes it down, one removed above pulls it up, a line
 * break typed at its start takes it along), and goes only when its line is deleted (its
 * content and one of its line breaks). `changes` are in the order of the text, not
 * overlapping, in `before`'s offsets.
 */
export function moveHighlights(lines: number[], before: string, changes: TextChange[], after: string): number[] {
  if (!lines.length || !changes.length) return lines
  const starts = lineStarts(before)
  const afterStarts = lineStarts(after)
  // Where an offset of `before` lands in `after`, past text inserted at it.
  const mapPos = (pos: number) => {
    let shift = 0
    for (const c of changes) {
      if (c.from > pos) break
      // Inside what was replaced: the end of what replaced it.
      if (pos < c.to) return c.from + shift + c.insert
      shift += c.insert - (c.to - c.from)
    }
    return pos + shift
  }
  // The plugin's isRemoved: every character of [from, to) is inside a changed range.
  const removed = (from: number, to: number) => {
    let pos = from
    for (const c of changes) if (c.from <= pos && c.to > pos) pos = c.to
    return pos >= to
  }
  const out: number[] = []
  for (const n of lines) {
    if (n > starts.length) continue
    const from = starts[n - 1]!
    const to = n < starts.length ? starts[n]! - 1 : before.length
    const breakGone = (from > 0 && removed(from - 1, from)) || (to < before.length && removed(to, to + 1))
    if (breakGone && removed(from, to)) continue
    const line = lineAt(afterStarts, Math.min(mapPos(from), after.length))
    if (out.at(-1) !== line) out.push(line)
  }
  return out
}

const lineStarts = (text: string) => {
  const out = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1)
  return out
}
/** The 1-based line an offset is on. */
function lineAt(starts: number[], pos: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= pos) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/** A language's title for a row or a card: the declared or the plugin's, else its value as stored. */
export const languageTitle = (language: string | undefined, options: CodeOptions = {}): string | undefined =>
  language ? (codeLanguages(options).find((l) => l.value === language) ?? CODE_LANGUAGES.find((l) => l.value === (ALIASES[language] ?? language)))?.title ?? language : undefined

/**
 * A code value as a row reads (an array item, a Portable Text card, a list preview): its
 * first line that holds text as the title (cut at 80), under it the filename and the
 * language. Empty code is titled by its filename, then its language.
 */
export function codePreview(value: unknown, options: CodeOptions = {}): {title: string; subtitle: string} {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as CodeValue) : {}
  const first = (typeof v.code === 'string' ? v.code : '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const language = languageTitle(typeof v.language === 'string' ? v.language : undefined, options)
  const filename = typeof v.filename === 'string' && v.filename.trim() ? v.filename.trim() : undefined
  const line = first.length > 80 ? `${first.slice(0, 79)}…` : first
  const rest = [filename, language].filter((x): x is string => !!x)
  return line ? {title: line, subtitle: rest.join(' · ')} : {title: rest[0] ?? '', subtitle: rest.slice(1).join(' · ')}
}

export type CodeDiffRow = {kind: 'same' | 'removed' | 'added'; text: string; was?: number; now?: number} | {kind: 'skip'; count: number}
/**
 * Two versions of code as rows, line by line: a removed line with its old number, an added
 * one with its new, and `context` unchanged lines around each change (the rest folded into
 * a skip row). Lines are matched by their longest common run; beyond `limit` cells of work
 * the changed middle is shown as removed then added.
 */
export function codeDiffRows(before: string, after: string, context = 2, limit = 4_000_000): CodeDiffRow[] {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const [n, m] = [a.length - head - tail, b.length - head - tail]
  const rows: Exclude<CodeDiffRow, {kind: 'skip'}>[] = []
  for (let i = 0; i < head; i++) rows.push({kind: 'same', text: a[i]!, was: i + 1, now: i + 1})
  if (n * m > limit) {
    for (let i = 0; i < n; i++) rows.push({kind: 'removed', text: a[head + i]!, was: head + i + 1})
    for (let j = 0; j < m; j++) rows.push({kind: 'added', text: b[head + j]!, now: head + j + 1})
  } else {
    // Longest common subsequence of the changed middle, from the end, so a walk from the start reads it.
    const width = m + 1
    const table = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i * width + j] = a[head + i] === b[head + j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    let [i, j] = [0, 0]
    while (i < n || j < m) {
      if (i < n && j < m && a[head + i] === b[head + j]) rows.push({kind: 'same', text: a[head + i]!, was: head + ++i, now: head + ++j})
      else if (i < n && (j >= m || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) rows.push({kind: 'removed', text: a[head + i]!, was: head + ++i})
      else rows.push({kind: 'added', text: b[head + j]!, now: head + ++j})
    }
  }
  for (let k = 0; k < tail; k++) rows.push({kind: 'same', text: a[a.length - tail + k]!, was: a.length - tail + k + 1, now: b.length - tail + k + 1})
  // Unchanged lines further than `context` from a change fold away.
  const near = new Uint8Array(rows.length)
  rows.forEach((r, at) => {
    if (r.kind !== 'same') for (let k = Math.max(0, at - context); k <= Math.min(rows.length - 1, at + context); k++) near[k] = 1
  })
  const out: CodeDiffRow[] = []
  for (let at = 0; at < rows.length; at++) {
    if (near[at]) out.push(rows[at]!)
    else {
      const last = out.at(-1)
      if (last?.kind === 'skip') last.count++
      else out.push({kind: 'skip', count: 1})
    }
  }
  return out
}
