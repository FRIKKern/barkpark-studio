import {lazy, Suspense, useEffect, useState} from 'react'
import {useT} from '../lib/i18n'
import {codeLanguage, codeOf, codePreview, type CodeOptions, type CodeValue} from '../lib/code-input'

// A code block's card in a Portable Text body (components/PortableTextInput.tsx): the code
// coloured as plain markup, nothing in it to focus or select, so the text editor around it
// keeps its caret. The colouring comes with the code editor's chunk (CodeEditor.tsx).

const CodeStatic = lazy(() => import('./CodeEditor').then((m) => ({default: m.CodeStatic})))
// Its own copies of the input's two small helpers: importing them would pull the form's input into every page's shared chunk.
const AtRest = ({code}: {code: string}) => <pre className="code-editor code-rest">{code}</pre>
function useClient() {
  const [client, setClient] = useState(false)
  useEffect(() => setClient(true), [])
  return client
}
const record = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as CodeValue) : undefined)

/** A code value on a card (a Portable Text block in the body): its filename and language, and the code coloured, read-only. */
export function CodeCard({value, options = {}}: {value: unknown; options?: CodeOptions}) {
  const t = useT()
  const client = useClient()
  const stored = record(value)
  const {mode} = codeLanguage(stored, options)
  const {code, lines} = codeOf(stored)
  if (!code) return <span className="code-card code-card-empty">{t('No code yet')}</span>
  return (
    <span className="code-card">
      {client ? (
        <Suspense fallback={<AtRest code={code} />}>
          <CodeStatic code={code} lines={lines} mode={mode} />
        </Suspense>
      ) : (
        <AtRest code={code} />
      )}
    </span>
  )
}

/** The line under a code card's or row's title: filename and language. */
export const codeCardLine = (value: unknown, options: CodeOptions = {}) => {
  const p = codePreview({...record(value), code: ''}, options)
  return [p.title, p.subtitle].filter(Boolean).join(' · ')
}
