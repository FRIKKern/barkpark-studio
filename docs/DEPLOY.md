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
in at build: change one, deploy again. On Vercel a deployment keeps the values it started
with, so any change needs a new deployment.

| Variable | Needed | What |
|---|---|---|
| `BARKPARK_URL` | yes | The Barkpark server, e.g. `https://gyl.barkpark.cloud` |
| `BARKPARK_WORKSPACE` | yes | Workspace slug |
| `BARKPARK_PROJECT`, `BARKPARK_DATASET` | no | Default `default`, `production` |
| `BARKPARK_TOKEN` | yes | The studio's service token: the sign-in screen's language, people pickers, …Rest, and a declared desk's tree (`/v1/structure` needs a read token with a seat in the workspace, Barkpark #24217; the people pickers list members, which needs an admin seat, so with a read token they are empty). Lent only to signed-in editors seated in that workspace. `BARKPARK_SERVICE_TOKEN`, if set, takes this role |
| `STUDIO_SIGN_IN` | no | `account` (production default): editors sign in with their Barkpark account. `sso`: editors sign in only through the instance's SSO (below), with no password form; a `BARKPARK_CLOUD_*` setting stops the studio. `shared`: everyone works as `BARKPARK_TOKEN` |
| `BARKPARK_CLOUD_URL`, `BARKPARK_CLOUD_INSTANCE` | no | Both set (with `account`): the sign-in screen offers **Sign in with Barkpark Cloud** above the password form. The Cloud web app (`https://barkpark.cloud`) and the Cloud id of `BARKPARK_URL`'s instance (`bp barkparks`). Below |
| `STUDIO_SSO_ORG` | with `sso` | The Barkpark organization whose OIDC connection editors sign in with. Below |
| `STUDIO_PUBLIC_URL` | no | The studio's public origin for Cloud or SSO sign-in, when the request's own is not it (a proxy) |
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

## Sign in with the instance's SSO

With `STUDIO_SIGN_IN=sso` the sign-in screen has one button. It sends the editor to
`BARKPARK_URL/v1/auth/oidc/<STUDIO_SSO_ORG>/start`, through the organization's identity
provider (Microsoft Entra ID for Gyldendal), and Barkpark's callback sends them back to
`<studio>/auth/cloud/callback` with a single-use 60 s ticket. The studio server trades it at
`POST /v1/auth/sso/exchange` (PKCE-bound, and bound to the studio's origin) for the editor's
login session. Barkpark returns only to a studio origin listed in its
`BARKPARK_STUDIO_SSO_ORIGINS` (comma-separated origins, `https://<studio>`). The organization's
group mappings decide the editor's seat in `BARKPARK_WORKSPACE`; without one the sign-in is
refused with "You don't have access to this workspace yet".

On a self-hosted instance, a workspace owner or admin signed in to `bp`, or the instance admin
token, mints `BARKPARK_TOKEN` with `bp instance studio-token --workspace <BARKPARK_WORKSPACE>`
(bp 1.26.3 or newer). It prints the `BARKPARK_TOKEN=` line once: a read token with a member seat.
The instance needs Barkpark from 2026-10-27 (5c9263fa5) or later. An older one answers 404:
update it first.

Until `bp` can sign in through SSO, an operator with root on the instance's VM uses the
admin token `deploy.sh` wrote to `/etc/barkpark/admin-token` (root only, mode 600). The
token goes from the VM straight into Vercel and is never shown:

```sh
ssh <user>@<vm> 'sudo sh -c "BARKPARK_API_URL=https://<host> BARKPARK_API_TOKEN=\$(cat /etc/barkpark/admin-token) bp instance studio-token --workspace <ws> -o json"' \
  | jq -r .token | vercel env add BARKPARK_TOKEN production --sensitive
```

A VM installed before `deploy.sh` wrote that file has none, and Barkpark has no command yet
that mints a new admin token on the VM. Keep one you mint there in that file, mode 600, and
its id in `/etc/barkpark/admin-token.id`.

List the studio's production origin in `BARKPARK_STUDIO_SSO_ORIGINS`: your domain, or
`https://<project>.vercel.app`. The deployment URL `vercel deploy` prints first,
`https://<project>-<hash>-<team>.vercel.app`, changes with every deployment. Restart Barkpark
after the change, then run `bp instance check --env-file <file> --studio-url <origin>`.

## Vercel

Deploy from the repository root with Root Directory `app`. The server imports
`scripts/lib/` and `fixtures/` from the root, so a deployment of `app/` alone fails.

| Setting | Value |
|---|---|
| Root Directory | `app`, with "Include files outside the root directory" on (the default) |
| Framework | TanStack Start (`app/vercel.json`) |
| Install / Build Command | `pnpm install --frozen-lockfile` / `pnpm build:vercel` (`app/vercel.json`) |
| Output Directory | framework default (do not set `dist`) |
| Node.js | 22.x. A new project starts on 24.x |

`app/vercel.json` cannot hold Root Directory or Node.js. Set both on the project:

```sh
vercel project add <project>
vercel link --project <project> --yes   # in the repository root
vercel api /v9/projects/<project> -X PATCH -f rootDirectory=app -f nodeVersion=22.x
```

Add each value from [Environment](#environment) with
`printf '%s' "<value>" | vercel env add <NAME> production`. Pipe the secrets so they never
reach the terminal:

```sh
openssl rand -base64 32 | tr -d '\n' | vercel env add STUDIO_SESSION_SECRET production --sensitive
bp instance studio-token --workspace <ws> -o json | jq -r .token \
  | vercel env add BARKPARK_TOKEN production --sensitive
vercel deploy --prod
```

`vercel env add` fails when the name already exists, and with `--sensitive` it shows only
"Saving…". Replace a value with `vercel env update <NAME> production` or remove it first
with `vercel env rm <NAME> production --yes`. Each `bp instance studio-token` run mints a
new token: keep the one Vercel holds and revoke the others with
`bp -w <ws> -p <project> token revoke <id> --yes`. `bp -w <ws> token ls` shows each
token's `last_used_at`, so the one the studio uses is the one with a recent read.

Any build on Vercel (`VERCEL=1`) uses the preset too. One Node 22 function
(`nodejs22.x`, streaming, 300 s) serves every page and API route; assets come from
Vercel's CDN, cached for a year. Vercel picks pnpm 10 for the lockfile; the build log's
pnpm and `engines` warnings are harmless.

A new project has Vercel Authentication on for deployment URLs only: each
`<project>-<hash>-<team>.vercel.app` asks for a Vercel login, while
`<project>.vercel.app` and your own domain stay open. To keep everyone but your people out,
protect all deployments in the project's Deployment Protection settings. Editors then sign
in twice, Vercel first, then Barkpark.

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
