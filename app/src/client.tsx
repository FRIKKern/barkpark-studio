// The client entry: TanStack Start's default, except that a document page hydrates once
// the editors' chunk is here (task-1e0a492c45a56a2e). Hydrating first left the editors'
// Suspense boundary dehydrated; the form's first update then made React draw its fallback,
// and the image field and the body vanished for ~0.8 s until the chunk landed. The chunk
// downloads with the page (modulepreload), so this rarely waits; clicks meanwhile are
// held (lib/hydrated.ts). Offline, it waits at most HYDRATE_WAIT_MS, as before J20.
import {StrictMode, startTransition} from 'react'
import {hydrateRoot} from 'react-dom/client'
import {StartClient} from '@tanstack/react-start/client'
import {loadDocEditors, onDocPage} from './components/DocEditors'

const HYDRATE_WAIT_MS = 1_500

const hydrate = () =>
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    )
  })

if (onDocPage()) void Promise.race([loadDocEditors(), new Promise((r) => setTimeout(r, HYDRATE_WAIT_MS))]).then(hydrate)
else hydrate()
