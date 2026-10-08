# Reference preview site

The site the reference Studio's Presentation tool shows, so J58–J64 have a Sanity
side to record against. Vite + React, three routes: `/` (posts), `/posts/:slug`,
`/authors/:id`.

```sh
pnpm install
SANITY_STUDIO_DATASET=e2e-local pnpm dev   # http://localhost:3536 (PREVIEW_PORT to change)
```

- Reads `SANITY_TOKEN` from the repo's `.env`. The dataset is private, so the token
  stays in the dev server (`/api/query`); the browser never sees it.
- Presentation enables draft mode through `/api/draft-mode/enable` (secret checked
  with `@sanity/preview-url-secret`), which sets a cookie: drafts, stega, overlays.
- Inside Presentation, `@sanity/react-loader` live mode takes over: the Studio runs
  the queries and streams results, so edits show without a reload.
- The Studio side is `reference/sanity/presentation.ts`: preview origin
  (`SANITY_STUDIO_PREVIEW_ORIGIN`, default `http://localhost:3536`), main documents
  per route, and locations for posts and authors. Set `SANITY_STUDIO_URL` here when
  the Studio is not on :3333.
