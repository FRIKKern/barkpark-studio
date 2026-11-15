import {lazy, Suspense, useEffect, useState} from 'react'
import type {Field} from '../lib/data'
import {codeOf} from '../lib/code-input'

// The code field's input (CodeInput.tsx, with its editor) is a chunk of its own, fetched in
// the browser when a form first shows a code field: a form without one pays nothing for it.
// Until it lands the code shows as plain text.
const CodeInput = lazy(() => import('./CodeInput'))

export function CodeField(props: {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const [client, setClient] = useState(false)
  useEffect(() => setClient(true), [])
  // Unsent edits kept over a reload make the browser's text differ from the server's: the input shows the browser's a moment later.
  const rest = (
    <pre className="code-editor code-rest" id={props.id} data-loading="" suppressHydrationWarning>
      {codeOf(props.value).code}
    </pre>
  )
  return client ? <Suspense fallback={rest}><CodeInput {...props} /></Suspense> : rest
}
