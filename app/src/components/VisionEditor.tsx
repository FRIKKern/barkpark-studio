import {useEffect, useRef} from 'react'
import {EditorState} from '@codemirror/state'
import {EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder as placeholderText} from '@codemirror/view'
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands'
import {HighlightStyle, StreamLanguage, syntaxHighlighting} from '@codemirror/language'
import {json} from '@codemirror/lang-json'
import {tags} from '@lezer/highlight'

// J37: Sanity's Vision edits its query and params in a code editor (line numbers, the
// current line marked, colouring). Ours is CodeMirror 6, loaded only with Vision (lazy:
// Vision.tsx), with a small mode for Barkpark's query string and JSON for Params.

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

const colours = HighlightStyle.define([
  {tag: tags.typeName, color: 'var(--code-number)'},
  {tag: [tags.propertyName], color: 'var(--code-key)'},
  {tag: [tags.keyword], color: 'var(--code-number)'},
  {tag: [tags.string], color: 'var(--code-string)'},
  {tag: [tags.variableName], color: 'var(--code-key)', fontWeight: '600'},
  {tag: [tags.number, tags.bool, tags.null], color: 'var(--code-number)'},
  {tag: [tags.operator, tags.punctuation, tags.brace, tags.separator], color: 'var(--muted)'},
])

const theme = EditorView.theme({
  '&': {height: '100%', fontSize: '12px', background: 'transparent', color: 'var(--fg)'},
  '.cm-scroller': {fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.6'},
  '.cm-gutters': {background: 'transparent', border: '0', color: 'var(--muted)'},
  '.cm-activeLine, .cm-activeLineGutter': {background: 'var(--hover)'},
  '&.cm-focused': {outline: 'none'},
  '&.cm-focused .cm-content': {caretColor: 'var(--fg-strong)'},
  '.cm-content': {padding: '4px 0'},
})

export default function VisionEditor({id, label, value, language, placeholder, onChange, onRun}: {id: string; label: string; value: string; language: 'query' | 'json'; placeholder?: string; onChange: (v: string) => void; onRun: () => void}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // The latest callbacks, read by the editor's handlers (made once).
  const calls = useRef({onChange, onRun})
  calls.current = {onChange, onRun}
  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          keymap.of([{key: 'Mod-Enter', preventDefault: true, run: () => (calls.current.onRun(), true)}, ...defaultKeymap, ...historyKeymap]),
          language === 'json' ? json() : barkparkQuery,
          syntaxHighlighting(colours),
          theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({id, 'aria-label': label}),
          ...(placeholder ? [placeholderText(placeholder)] : []),
          EditorView.updateListener.of((u) => u.docChanged && calls.current.onChange(u.state.doc.toString())),
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
