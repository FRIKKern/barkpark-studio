import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {Annotation, Compartment, EditorState, StateEffect, StateField, Transaction, type Extension} from '@codemirror/state'
import {Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers} from '@codemirror/view'
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands'
import {bracketMatching, indentOnInput, Language, LanguageSupport, StreamLanguage, syntaxHighlighting} from '@codemirror/language'
import {classHighlighter, highlightCode} from '@lezer/highlight'
import {autoClose, groq} from './VisionEditor'
import {changeBetween, moveHighlights, toggleLine, type CodeMode, type TextChange} from '../lib/code-input'

// The code field's editor (lib/code-input.ts): CodeMirror 6, as Vision's (VisionEditor.tsx),
// in its own chunk, fetched with the first code field or code block a form shows. Each
// language's colouring is a chunk of its own, fetched when a value in that language is
// shown: a form with no code field pays for none of it. A click on a line number (or
// Ctrl+Alt+H on the caret's line) toggles its highlight; highlights follow their lines as
// the code is edited. Tab indents; Escape, then Tab, moves on (CodeMirror's own way out).

/** A language's colouring, by the plugin's mode names; plain text has none. */
const MODES: Record<CodeMode, () => Promise<Extension | undefined>> = {
  text: async () => undefined,
  groq: async () => groq,
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({jsx: true})),
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({typescript: true})),
  tsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({jsx: true, typescript: true})),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  php: () => import('@codemirror/lang-php').then((m) => m.php()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  mysql: () => import('@codemirror/lang-sql').then((m) => m.sql({dialect: m.MySQL})),
  java: () => import('@codemirror/lang-java').then((m) => m.java()),
  csharp: () => import('@codemirror/legacy-modes/mode/clike').then((m) => StreamLanguage.define(m.csharp)),
  sh: () => import('@codemirror/legacy-modes/mode/shell').then((m) => StreamLanguage.define(m.shell)),
  css: () => import('@codemirror/legacy-modes/mode/css').then((m) => StreamLanguage.define(m.css)),
  scss: () => import('@codemirror/legacy-modes/mode/css').then((m) => StreamLanguage.define(m.sCSS)),
  sass: () => import('@codemirror/legacy-modes/mode/sass').then((m) => StreamLanguage.define(m.sass)),
  ruby: () => import('@codemirror/legacy-modes/mode/ruby').then((m) => StreamLanguage.define(m.ruby)),
  python: () => import('@codemirror/legacy-modes/mode/python').then((m) => StreamLanguage.define(m.python)),
  xml: () => import('@codemirror/legacy-modes/mode/xml').then((m) => StreamLanguage.define(m.xml)),
  yaml: () => import('@codemirror/legacy-modes/mode/yaml').then((m) => StreamLanguage.define(m.yaml)),
  golang: () => import('@codemirror/legacy-modes/mode/go').then((m) => StreamLanguage.define(m.go)),
}

// Colours come from the tokens' classes (`tok-keyword`, …; code-input.css gives each the studio's
// syntax colour, light and dark), so the editor and a card's static code share them.
const theme = EditorView.theme({
  '&': {fontSize: '13px', background: 'transparent', color: 'var(--input-fg)'},
  '.cm-scroller': {fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.55', overflow: 'auto'},
  '.cm-gutters': {background: 'var(--code-gutter-bg)', borderRight: '1px solid var(--code-gutter-rule)', color: 'var(--code-gutter-fg)'},
  '.cm-lineNumbers .cm-gutterElement': {minWidth: '32px', padding: '0 8px'},
  '&[data-toggles] .cm-lineNumbers .cm-gutterElement': {cursor: 'pointer'},
  '.cm-content': {padding: '8px 0', caretColor: 'var(--fg-strong)'},
  '.cm-line': {padding: '0 12px'},
  // The current line shows while the caret is in the editor only: at rest a field marks nothing.
  '.cm-activeLine, .cm-activeLineGutter': {background: 'transparent'},
  '&.cm-focused .cm-activeLine': {background: 'var(--code-active-line)'},
  '&.cm-focused .cm-activeLineGutter': {background: 'var(--code-active-gutter)'},
  '.cm-code-highlight': {background: 'var(--code-highlight-line)'},
  '&.cm-focused .cm-code-highlight.cm-activeLine': {background: 'var(--code-highlight-line)'},
  '&.cm-focused': {outline: 'none'},
})

/** A change that came from outside the editor (someone else's save, a restore, another version shown): never sent back. */
const outside = Annotation.define<boolean>()
const setLines = StateEffect.define<number[]>()
const sameLines = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i])

/** The highlighted lines, 1-based: set from outside or by a toggle, and moved with their content by an edit. */
const linesField = StateField.define<number[]>({
  create: () => [],
  update(lines, tr) {
    for (const e of tr.effects) if (e.is(setLines)) return e.value
    if (!tr.docChanged || !lines.length) return lines
    const changes: TextChange[] = []
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({from, to, insert: inserted.length}))
    const next = moveHighlights(lines, tr.startState.doc.toString(), changes, tr.newDoc.toString())
    return sameLines(next, lines) ? lines : next
  },
})
const highlight = Decoration.line({class: 'cm-code-highlight'})
const highlights = EditorView.decorations.compute([linesField, 'doc'], (state) =>
  Decoration.set(state.field(linesField).filter((n) => n <= state.doc.lines).map((n) => highlight.range(state.doc.line(n).from)), true),
)
const toggle = (view: EditorView, line: number) => (view.dispatch({effects: setLines.of(toggleLine(view.state.field(linesField), line))}), true)

/** CodeMirror keeps its text with `\n` between lines; a stored `\r\n` reads the same and is left as stored until edited. */
const unix = (text: string) => text.replace(/\r\n?/g, '\n')

export type CodeEditorProps = {
  id?: string
  label: string
  describedBy?: string
  code: string
  lines: number[]
  mode: CodeMode
  readOnly?: boolean
  onCode?: (code: string) => void
  onLines?: (lines: number[]) => void
}

export default function CodeEditor({id, label, describedBy, code, lines, mode, readOnly = false, onCode, onLines}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const calls = useRef({onCode, onLines})
  calls.current = {onCode, onLines}
  const language = useRef(new Compartment())
  // What this editor sent and has not seen come back yet: a value in here is its own echo
  // (an older one while the author typed on), anything else is someone else's.
  const sent = useRef<{code: string[]; lines: string[]; at: number}>({code: [], lines: [], at: 0})
  const latest = useRef({code, lines})
  latest.current = {code, lines}

  useEffect(() => {
    const v = (view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: code,
        extensions: [
          linesField.init(() => lines),
          highlights,
          lineNumbers(readOnly ? {} : {domEventHandlers: {mousedown: (v, line) => toggle(v, v.state.doc.lineAt(line.from).number)}}),
          ...(readOnly ? [] : [highlightActiveLine(), highlightActiveLineGutter(), bracketMatching(), indentOnInput(), autoClose, history()]),
          keymap.of(readOnly ? defaultKeymap : [{key: 'Ctrl-Alt-h', preventDefault: true, run: (v) => toggle(v, v.state.doc.lineAt(v.state.selection.main.head).number)}, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          language.current.of([]),
          syntaxHighlighting(classHighlighter),
          theme,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.editorAttributes.of(readOnly ? {} : {'data-toggles': ''}),
          EditorView.contentAttributes.of({...(id ? {id} : {}), 'aria-label': label, ...(describedBy ? {'aria-describedby': describedBy} : {}), ...(readOnly ? {tabindex: '0', 'aria-readonly': 'true'} : {})}),
          EditorView.updateListener.of((u) => {
            if (readOnly || u.transactions.every((tr) => tr.annotation(outside))) return
            const s = sent.current
            if (u.docChanged) {
              const text = u.state.doc.toString()
              if (s.code.push(text) > 64) s.code.shift()
              s.at = Date.now()
              calls.current.onCode?.(text)
            }
            const now = u.state.field(linesField)
            if (!sameLines(now, u.startState.field(linesField))) {
              if (s.lines.push(now.join()) > 64) s.lines.shift()
              s.at = Date.now()
              calls.current.onLines?.(now)
            }
          }),
        ],
      }),
    }))
    return () => v.destroy()
  }, [])

  // The colouring for this language, once its chunk is here; one that fails to load is plain text.
  useEffect(() => {
    let live = true
    void (MODES[mode] ?? MODES.text)()
      .catch(() => undefined)
      .then((ext) => live && view.current?.dispatch({effects: language.current.reconfigure(ext ?? [])}))
    return () => void (live = false)
  }, [mode])

  // A value from outside (another editor's save, a restore, Discard changes, the published
  // version shown): the editor follows, the caret kept on its text, nothing sent back and
  // nothing added to the editor's own undo.
  const linesKey = lines.join()
  useLayoutEffect(() => {
    const follow = (force: boolean) => {
      const v = view.current
      if (!v) return
      const s = sent.current
      const want = unix(latest.current.code)
      const wantLines = latest.current.lines
      const doc = v.state.doc.toString()
      const change = want === doc ? null : changeBetween(doc, want)
      const linesDiffer = !sameLines(wantLines, v.state.field(linesField))
      // Caught up: nothing of its own is on its way any more.
      if (!change) s.code = []
      if (!linesDiffer) s.lines = []
      if (!change && !linesDiffer) return
      // Its own older value, with newer ones on their way: wait for those. Checked again
      // shortly, so an echo that never comes cannot leave the editor showing what is not stored.
      if (!force && (change ? s.code.includes(want) : s.lines.includes(wantLines.join()))) return void (timer = setTimeout(() => follow(Date.now() - sent.current.at > 400), 500))
      s.code = []
      s.lines = []
      v.dispatch({
        ...(change ? {changes: {from: change.from, to: change.to, insert: want.slice(change.from, change.from + change.insert)}} : {}),
        effects: setLines.of(wantLines),
        annotations: [outside.of(true), Transaction.addToHistory.of(false)],
      })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    follow(false)
    return () => clearTimeout(timer)
  }, [code, linesKey])

  return <div ref={host} className="code-editor" data-language={mode} data-readonly={readOnly || undefined} />
}

/**
 * Code coloured as plain markup, for a card (a Portable Text block in the body): no editor,
 * nothing to focus or select, its highlighted lines marked. Past 100 000 characters, or
 * until the language's chunk is here, it is the text uncoloured.
 */
export function CodeStatic({code, lines, mode}: {code: string; lines: number[]; mode: CodeMode}) {
  const [language, setLanguage] = useState<Language | null>(null)
  useEffect(() => {
    let live = true
    void (MODES[mode] ?? MODES.text)()
      .catch(() => undefined)
      .then((ext) => live && setLanguage(ext instanceof LanguageSupport ? ext.language : ext instanceof Language ? ext : null))
    return () => void (live = false)
  }, [mode])
  const rows = useMemo(() => {
    const text = unix(code)
    if (!language || text.length > 100_000) return text.split('\n').map((line): ReactNode[] => [line])
    const out: ReactNode[][] = [[]]
    let n = 0
    highlightCode(text, language.parser.parse(text), classHighlighter, (part, classes) => out.at(-1)!.push(classes ? <span key={n++} className={classes}>{part}</span> : part), () => out.push([]))
    return out
  }, [code, language])
  return (
    <pre className="code-editor code-static" data-language={mode}>
      <code>
        {rows.map((row, i) => (
          <span key={i} className={lines.includes(i + 1) ? 'code-line cm-code-highlight' : 'code-line'}>
            {row}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  )
}
