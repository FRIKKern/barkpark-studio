# Deploying the studio

One app, two hosts. A client deployment is configured by environment variables alone:
no fork of `app/src/studio.config.tsx`. Its desk and types live in Barkpark (a published
`deskStructure` document and the dataset's schemas, [EXTENDING](EXTENDING.md)).

| Host | Build | Output | Serve |
|---|---|---|---|
| Your own Node 22 server | `pnpm --dir app build` | `app/dist/` | `pnpm --dir app serve` (`vite preview`, :3000), behind HTTPS with HTTP/2 |
| Vercel | `pnpm --dir app build:vercel` (Nitro's `vercel` preset) | `app/.vercel/output/` | Vercel |

## Environment

Server values are read at run time and never reach the browser. `VITE_*` values are baked
in at build: change one, deploy again.

| Variable | Needed | What |
|---|---|---|
| `BARKPARK_URL` | yes | The Barkpark server, e.g. `https://gyl.barkpark.cloud` |
| `BARKPARK_WORKSPACE` | yes | Workspace slug |
| `BARKPARK_PROJECT`, `BARKPARK_DATASET` | no | Default `default`, `production` |
| `BARKPARK_TOKEN` | yes | The studio's service token: the sign-in screen's language, people pickers, …Rest, and a declared desk's tree (`/v1/structure` needs an admin seat in the workspace). Lent only to signed-in editors seated in that workspace. `BARKPARK_SERVICE_TOKEN`, if set, takes this role |
| `STUDIO_SIGN_IN` | no | `account` (production default): editors sign in with their Barkpark account. `shared`: everyone works as `BARKPARK_TOKEN` |
| `STUDIO_SESSION_SECRET` | yes on Vercel | 32+ random characters (`openssl rand -base64 32`) sealing sign-in cookies. Every instance must share it; a Vercel build refuses sign-ins without it |
| `STUDIO_LOCALE` | no | `nb-NO` or `en` forces the interface language; otherwise the workspace's |
| `VITE_STUDIO_TITLE` | no | The studio's name in the navbar |
| `VITE_STUDIO_TOOLS` | no | e.g. `structure,vision`: only these tools, in this order |
| `VITE_PREVIEW_ORIGIN_OVERRIDE` | no | Swaps the origin of every schema's `desk.preview` template |
| `VITE_FORM_VIEW_TITLE`, `VITE_HIDE_JSON_VIEW=1` | no | The form tab's name; drop the JSON tab |

Never set `STUDIO_DEV_LOGIN` or `BARKPARK_ADMIN_TOKEN` on a deployment: a production build
refuses dev sign-in.

## Vercel

Project settings (also in `app/vercel.json`):

| Setting | Value |
|---|---|
| Root Directory | `app` |
| Framework | TanStack Start |
| Install / Build Command | `pnpm install --frozen-lockfile` / `pnpm build:vercel` |
| Output Directory | framework default (do not set `dist`) |
| Node.js | 22.x |

Any build on Vercel (`VERCEL=1`) uses the preset too. One Node 22 function
(`nodejs22.x`, streaming, 300 s) serves every page and API route; assets come from
Vercel's CDN, cached for a year. Put Vercel Authentication in front if only your
people should reach it: editors then sign in twice, Vercel first, then Barkpark.

What differs from `serve`: a live stream (`/api/stream`) ends at 300 s and the tab
reopens it; a tab's pane change that reaches another instance gets 404 and the tab
reopens its stream there. No warm-up at boot, and no early preload of the editor chunk.

Check a build without deploying it:

```sh
pnpm --dir app install --frozen-lockfile
VITE_STUDIO_TITLE="My Studio" pnpm --dir app build:vercel
node scripts/verify-vercel-build.mjs   # loopback only: layout, function, /api/version, sign-in page
```

`vercel build` in a linked checkout gives the same output. `.vercel/` is never committed.
