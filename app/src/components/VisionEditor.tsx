import {useEffect, useRef} from 'react'
import {Compartment, EditorState} from '@codemirror/state'
import {EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder as placeholderText} from '@codemirror/view'
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands'
import {bracketMatching, HighlightStyle, LanguageSupport, StreamLanguage, syntaxHighlighting} from '@codemirror/language'
import {jsonLanguage} from '@codemirror/lang-json'
import {styleTags, tags} from '@lezer/highlight'
import {isQueryString} from '../lib/vision-groq'

// J37: Sanity's Vision edits its query and params in a code editor (line numbers, the
// current line marked, colouring). Ours is CodeMirror 6, loaded only with Vision (lazy:
// Vision.tsx), with small modes for GROQ and Barkpark's query string (the editor follows
// whichever the text is) and JSON for Params.

/** Barkpark's query: `type?key[op]=value&…` — the type, keys, operators in brackets, values, `$params`. */
const barkparkQuery = StreamLanguage.define<{part: 'type' | 'key' | 'value'}>({
  startState: () => ({part: 'type'}),
  token(stream, state) {
    if (stream.match(/^\$[A-Za-z_]\w*/)) return 'variableName'
    if (stream.eat('?') || stream.eat('&')) return (state.part = 'key'), 'operator'
    if (state.part !== 'value' && stream.eat('=')) return (state.part = 'value'), 'operator'
    if (state.part === 'type') return stream.match(/^[^?$]+/), 'typeName'
    if (state.part === 'key') {
      if (stream.eat('[')) return stream.match(/^[^\]]*/), stream.eat(']'), 'keyword'
      return stream.match(/^[^[=&$]+/), 'propertyName'
    }
    return stream.match(/^[^&$]+/), 'string'
  },
})

/** GROQ, coloured as Sanity's Vision colours it (measured at 1440, light and dark): fields, strings,
 * constants (`*`, numbers, true, `,` and `:`), operators and `asc`/`desc`, functions, brackets, comments. */
const groq = StreamLanguage.define<null>({
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(/^\/\/.*/)) return 'comment'
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string'
    if (stream.match(/^-?\d+(\.\d+)?/)) return 'number'
    if (stream.match(/^\$[A-Za-z_]\w*/)) return 'variableName'
    if (stream.match(/^(true|false|null)\b/)) return 'bool'
    if (stream.match(/^(in|match|asc|desc)\b/)) return 'keyword'
    if (stream.match(/^[A-Za-z_][\w:]*(?=\s*\()/)) return 'macroName'
    if (stream.match(/^[A-Za-z_]\w*/)) return 'propertyName'
    if (stream.eat('*') || stream.eat('^') || stream.eat('@')) return 'atom'
    if (stream.match(/^(->|==|!=|<=|>=|&&|\|\||\.\.\.|\.\.|[.|=<>!+\-/%])/)) return 'operator'
    if (stream.match(/^[[\](){}]/)) return 'bracket'
    stream.next()
    return 'separator'
  },
})
const languageOf = (text: string) => (isQueryString(text) ? barkparkQuery : groq)

/** Params as Sanity's colours them: keys in the string brown, `:` a bracket, null an operator. */
const params = new LanguageSupport(jsonLanguage.configure({props: [styleTags({PropertyName: tags.special(tags.string), ':': tags.special(tags.bracket), Null: tags.special(tags.null)})]}))

const colours = HighlightStyle.define([
  {tag: tags.typeName, color: 'var(--syntax-constant)'},
  {tag: [tags.propertyName], color: 'var(--syntax-property)'},
  {tag: [tags.keyword, tags.operator], color: 'var(--syntax-operator)'},
  {tag: [tags.string], color: 'var(--syntax-string)'},
  {tag: [tags.variableName], color: 'var(--syntax-property)', fontWeight: '600'},
  {tag: [tags.number, tags.bool, tags.null, tags.atom, tags.separator], color: 'var(--syntax-constant)'},
  {tag: tags.macroName, color: 'var(--syntax-function)'},
  {tag: [tags.bracket, tags.punctuation, tags.brace], color: 'var(--syntax-bracket)'},
  {tag: tags.comment, color: 'var(--syntax-comment)'},
  {tag: tags.special(tags.string), color: 'var(--syntax-string)'},
  {tag: tags.special(tags.bracket), color: 'var(--syntax-bracket)'},
  {tag: tags.special(tags.null), color: 'var(--syntax-operator)'},
])

const theme = EditorView.theme({
  // Sanity's Vision editor: 16 px code, a grey line-number gutter down the whole editor, a blue current line.
  '&': {height: '100%', fontSize: '16px', background: 'transparent', color: 'var(--fg-header)'},
  '.cm-scroller': {fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.4'},
  '.cm-gutters': {minHeight: '100%', background: 'var(--code-gutter-bg)', borderRight: '1px solid var(--code-gutter-rule)', color: 'var(--code-gutter-fg)'},
  // Text starts 12 px past the gutter, in line with the pane's label.
  '.cm-line': {paddingLeft: '12px'},
  '.cm-activeLine': {background: 'var(--code-active-line)'},
  '.cm-activeLineGutter': {background: 'var(--code-active-gutter)'},
  '&.cm-focused': {outline: 'none'},
  '&.cm-focused .cm-content': {caretColor: 'var(--fg-strong)'},
  // The first line starts below the pane's label (Vision.tsx), Sanity's 32 px; lines stop 20 px short of the edge.
  '.cm-content': {padding: '32px 20px 4px 0'},
})

// Sanity's Vision editors close brackets and quotes as you type (CodeMirror's closeBrackets,
// without its package): an opener adds its closer after the caret, a closer typed before its
// twin steps over it, and Backspace inside an empty pair takes both.
const PAIRS: Record<string, string> = {'(': ')', '[': ']', '{': '}', '"': '"', "'": "'"}
const CLOSERS = new Set(Object.values(PAIRS))
export const autoClose = [
  EditorView.inputHandler.of((view, from, to, text) => {
    if (text.length !== 1 || view.composing) return false
    const next = view.state.sliceDoc(to, to + 1)
    if (from === to && CLOSERS.has(text) && next === text) return view.dispatch({selection: {anchor: from + 1}, userEvent: 'input.type'}), true
    const close = PAIRS[text]
    if (!close || (from === to && /\w/.test(next))) return false
    if (close === text && /\w/.test(view.state.sliceDoc(from - 1, from))) return false
    view.dispatch({changes: {from, to, insert: text + view.state.sliceDoc(from, to) + close}, selection: {anchor: from + 1, head: to + 1}, userEvent: 'input.type'})
    return true
  }),
  keymap.of([
    {
      key: 'Backspace',
      run: (view) => {
        const s = view.state.selection.main
        if (!s.empty || PAIRS[view.state.sliceDoc(s.from - 1, s.from)] !== view.state.sliceDoc(s.from, s.from + 1)) return false
        view.dispatch({changes: {from: s.from - 1, to: s.from + 1}, userEvent: 'delete.backward'})
        return true
      },
    },
  ]),
]

export default function VisionEditor({id, label, value, language, placeholder, onChange, onRun}: {id: string; label: string; value: string; language: 'query' | 'json'; placeholder?: string; onChange: (v: string) => void; onRun: (text: string) => void}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // The latest callbacks, read by the editor's handlers (made once).
  const calls = useRef({onChange, onRun})
  calls.current = {onChange, onRun}
  const mode = useRef(new Compartment())
  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          bracketMatching(),
          autoClose,
          history(),
          keymap.of([{key: 'Mod-Enter', preventDefault: true, run: (v) => (calls.current.onRun(v.state.doc.toString()), true)}, ...defaultKeymap, ...historyKeymap]),
          mode.current.of(language === 'json' ? params : languageOf(value)),
          syntaxHighlighting(colours),
          theme,
          EditorView.contentAttributes.of({id, 'aria-label': label}),
          ...(placeholder ? [placeholderText(placeholder)] : []),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            const text = u.state.doc.toString()
            calls.current.onChange(text)
            // GROQ or a query string: the colouring follows what the text has become.
            if (language === 'query' && isQueryString(text) !== isQueryString(u.startState.doc.toString())) queueMicrotask(() => u.view.dispatch({effects: mode.current.reconfigure(languageOf(text))}))
          }),
        ],
      }),
    })
    return () => view.current?.destroy()
  }, [])
  // A value set from outside (a saved query loaded, a reset): the editor follows.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({changes: {from: 0, to: v.state.doc.length, insert: value}})
  }, [value])
  return <div ref={host} className="vision-editor" data-language={language} />
}
