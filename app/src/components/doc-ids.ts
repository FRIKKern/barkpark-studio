import {createContext} from 'react'

// Apart from Fields.tsx so a reference picker outside the document pane (search filters)
// needn't bring the whole form with it (task-a8874d0ebb2baa5c).
/** The doc's id: steady while typing, for what only needs to know which doc. */
export const DocIdContext = createContext<string | null>(null)
/** The doc's type, steady too (a richText field's canvas saves to its own doc). */
export const DocTypeContext = createContext<string | null>(null)
