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
| `BARKPARK_TOKEN` | yes | The studio's service token: the sign-in screen's language, people pickers, …Rest, and a declared desk's tree (`/v1/structure` needs a read token with a seat in the workspace, Barkpark #24217; the people pickers list members, which needs an admin seat, so with a read token they are empty). Lent only to signed-in editors seated in that workspace. `BARKPARK_SERVICE_TOKEN`, if set, takes this role |
| `STUDIO_SIGN_IN` | no | `account` (production default): editors sign in with their Barkpark account. `shared`: everyone works as `BARKPARK_TOKEN` |
| `BARKPARK_CLOUD_URL`, `BARKPARK_CLOUD_INSTANCE` | no | Both set (with `account`): the sign-in screen offers **Sign in with Barkpark Cloud** above the password form. The Cloud web app (`https://barkpark.cloud`) and the Cloud id of `BARKPARK_URL`'s instance (`bp barkparks`). Below |
| `STUDIO_PUBLIC_URL` | no | The studio's public origin for that sign-in, when the request's own is not it (a proxy) |
| `STUDIO_SESSION_SECRET` | yes on Vercel | 32+ random characters (`openssl rand -base64 32`) sealing sign-in cookies. Every instance must share it; a Vercel build refuses sign-ins without it |
| `STUDIO_LOCALE` | no | `nb-NO` or `en` forces the interface language; otherwise the workspace's |
| `STUDIO_DESK_ID` | no | The published `deskStructure` document this studio's desk is (default `deskStructure`), e.g. `deskStructure.pensum` for a second studio on the same dataset. Letters, digits, `_ . -`, no `drafts.`; another value is refused: every content-model read fails with the reason. A non-default desk needs Barkpark's `/v1/structure?desk=`; without it the desk shows an error, never the other studio's desk |
| `VITE_STUDIO_TITLE` | no | The studio's name in the navbar and the browser tab |
| `VITE_STUDIO_TOOLS` | no | e.g. `structure,vision`: only these tools, in this order |
| `VITE_PREVIEW_ORIGIN_OVERRIDE` | no | Swaps the origin of every schema's `desk.preview` template |
| `VITE_FORM_VIEW_TITLE`, `VITE_HIDE_JSON_VIEW=1` | no | The form tab's name; drop the JSON tab |

Never set `STUDIO_DEV_LOGIN` or `BARKPARK_ADMIN_TOKEN` on a deployment: a production build
refuses dev sign-in.

## Sign in with Barkpark Cloud

The editor signs in at Barkpark Cloud with the account `bp login` uses, as a member of the
instance's Cloud team. Cloud sends them back to `<studio>/auth/cloud/callback` with a
single-use 60 s ticket, which the studio server trades at `BARKPARK_URL` for the editor's
login session (`POST /v1/auth/login-tickets/exchange`, PKCE-bound). Cloud only returns to a
callback a team admin listed for the instance, once per studio:

```sh
bp barkparks studio-callback add <instance> https://<studio>/auth/cloud/callback
```

The editor needs a seat in `BARKPARK_WORKSPACE` already: without one the sign-in is
refused with "You don't have access to this workspace yet". Password sign-in stays.

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
