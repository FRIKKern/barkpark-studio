import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {App} from './App'
import {connectBarkpark, openShared} from './barkpark'

// A next-sanity site speaks Sanity's comlink only (PREVIEW_SOURCE=sanity-on-barkpark): no bridge.
declare const __API_HOST__: string
if (!__API_HOST__) connectBarkpark()
openShared()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
