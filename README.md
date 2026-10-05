# Barkpark Studio

A Sanity-Studio-quality editing UI for Barkpark, built with TanStack Start.

**The goal is not features. The goal is parity of feel.** A journey is done when
it matches Sanity Studio side by side, in a real browser, and a test locks it.

## Where things live (one fact, one home)

| What | Where |
|---|---|
| Why + plan + doctrine | Paper `/papers/barkpark-studio-parity-plan` |
| The quality bar | [`QUALITY.md`](QUALITY.md) |
| The journeys (the spec) | [`JOURNEYS.md`](JOURNEYS.md) |
| Decisions | [`docs/decisions/`](docs/decisions/) — one page each |
| Status / who is doing what | Barkpark tasks under goal `task-130be6b834d485ae` — never in docs |

## Layout

```
app/                 TanStack Start studio (ours)
reference/sanity/    real Sanity Studio — the bar (project 0ozn679s, dataset production)
fixtures/seed.ndjson same seed data for both sides
e2e/                 Playwright: journeys, two-browser rig, timing budgets
docs/decisions/      ADRs, max one page
```

## Run the reference

```sh
cd reference/sanity && pnpm dev        # http://localhost:3333
npx sanity dataset import ../../fixtures/seed.ndjson production --replace   # reset data
```

## Seed Barkpark

```sh
cp .env.example .env                                  # fill BARKPARK_TOKEN (+ SANITY_TOKEN to also verify the reference)
node --env-file=.env scripts/seed-barkpark.mjs        # apply fixtures/barkpark-schema, reset studio-parity, verify
node --env-file=.env scripts/seed-barkpark.mjs --verify
```

## Run the studio

```sh
cd app && pnpm install && pnpm dev     # http://localhost:3000 (health) · /debug/live?id=post-01 (live stream)
pnpm check                             # typecheck + build; fails if client code imports src/server
```

The Barkpark token stays server-side: `app/src/server/` reads the repo-root `.env`
and is the only code that talks to Barkpark. The browser calls same-origin
`/api/{query,doc,mutate,history,backlinks,schemas,listen}`.
