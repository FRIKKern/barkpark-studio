# Reference preview site

The site the reference Studio's Presentation tool shows, so J58–J64 have a Sanity
side to record against. Vite + React, three routes: `/` (posts), `/posts/:slug`,
`/authors/:id`.

```sh
pnpm install
SANITY_STUDIO_DATASET=e2e-local pnpm dev   # http://localhost:3536 (PREVIEW_PORT to change)
PREVIEW_SOURCE=barkpark PREVIEW_DATASET=e2e-local PREVIEW_PORT=3537 pnpm dev   # the same pages from Barkpark
```

- **Two sources, one site.** Sanity's Presentation shows the Sanity copy (:3536); ours
  shows the Barkpark copy (:3537, `barkpark-server.ts`). No editor's token: inside the
  studio's Presentation, single-use preview tokens the editor's studio mints for each
  read (scoped to their workspace; any member who may write) read drafts or published;
  outside it, `BARKPARK_SITE_TOKEN` in the repo's `.env`, a public-read
  token (`bp --workspace studio-parity token create "preview-site (barkpark-studio
  reference)" --permissions public-read`; revoke: `bp --workspace studio-parity token
  revoke <id>`, id in `bp token ls`).

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
- Barkpark Studio's Presentation (J58) talks to the page through `src/barkpark.ts`:
  the page posts `{bp: 'preview', type: 'hello' | 'location'}` to its parent and
  takes `{bp: 'studio', type: 'navigate' | 'refresh'}` back. Sanity's comlink is
  untouched, so the same page serves both studios.
