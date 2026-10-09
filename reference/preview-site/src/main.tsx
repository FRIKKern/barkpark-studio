import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {App} from './App'
import {connectBarkpark, openShared} from './barkpark'

connectBarkpark()
openShared()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
