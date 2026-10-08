[![Barkpark Studio roadmap: phases 0 to 6 and after with journeys passing out of total, plus the Freeform side track counted apart](docs/images/roadmap.svg)](docs/ROADMAP.md)

## Vision

Editors should not notice they left Sanity. Barkpark Studio gives Barkpark the
editing feel people love in Sanity Studio: panes that open to the right without
end, references you can follow, pick, create and edit without losing your place,
typing that never waits on the network, and two people in one document, live.

We get there one journey at a time, each signed off side by side against a real
Sanity Studio in a real browser; tests stay few and fast. The journey list grows
whenever a scout finds an honest gap. Then plugins and a Presentation tool.

Past Sanity, the Freeform track: PortableDoc documents open in Barkpark's shared
canvas, the editor Barkdown hosts ([0004](docs/decisions/0004-portabledoc-freeform.md)).
Built with TanStack Start on Barkpark ([0001](docs/decisions/0001-stack-and-backend.md)).

## What happened

<!-- timeline:start -->
- **Today** · 15 changes, 3 tasks closed
  - B03: tick list rows, publish or unpublish them in one go ([#131](https://github.com/FRIKKern/barkpark-studio/pull/131))
  - Done: [J38 [after] Global search filters: type chips, field filters, ordering](https://github.com/FRIKKern/barkpark/issues/21783)
  - J38: global search filters match Sanity side by side ([#130](https://github.com/FRIKKern/barkpark-studio/pull/130))
- **Yesterday** · 10 changes, 13 tasks closed
  - Done: [J26 [1 Panes+Refs] Split pane right on a doc, edit both sides, close the split](https://github.com/FRIKKern/barkpark/issues/21771)
  - Done: [J25 [1 Panes+Refs] List "…" menu: sort by created / last edited, compact / detailed view; sticks per type](https://github.com/FRIKKern/barkpark/issues/21770)
- **This week** · 97 changes, 25 tasks closed
  - D10: Norwegian letters, dead keys and IME type correctly in the canvas; a 500-block doc keeps F1 ([#98](https://github.com/FRIKKern/barkpark-studio/pull/98))
  - D07: paste or drop a picture into the canvas — uploaded to Barkpark media, uploading badge, failure on the block ([#97](https://github.com/FRIKKern/barkpark-studio/pull/97))
<!-- timeline:end -->

## Where things live (one fact, one home)

| What | Where |
|---|---|
| Why + plan + doctrine | Paper [`barkpark-studio-parity-plan`](https://guerrilla.barkpark.cloud/papers/barkpark-studio-parity-plan) |
| Phases | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| The quality bar + test budget | [`QUALITY.md`](QUALITY.md) |
| The journeys (the spec) | [`JOURNEYS.md`](JOURNEYS.md) |
| How we work | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Ported code + licenses | [`THIRD-PARTY.md`](THIRD-PARTY.md) |
| Decisions | [`docs/decisions/`](docs/decisions/), one page each |
| Status, who does what | Barkpark tasks under goal `task-130be6b834d485ae`, mirrored to [FRIKKern/barkpark#21665](https://github.com/FRIKKern/barkpark/issues/21665). Never in docs |
| Bugs, "feels off", server gaps | [New issue](https://github.com/FRIKKern/barkpark-studio/issues/new/choose) → lands on that board ([0003](docs/decisions/0003-tracking-and-hygiene.md)) |

## Layout

```
app/                 TanStack Start studio (ours); only app/src/server/ talks to Barkpark
reference/sanity/    real Sanity Studio, the bar (project 0ozn679s, dataset production)
fixtures/            seed data + Barkpark schema, same content on both sides
e2e/                 Playwright: few, fast specs for what can break silently
scripts/             seed Barkpark, README timeline, roadmap picture, doc checks
spikes/concurrent-text/  reproducible two-browser concurrency comparison (decision 0002)
docs/                roadmap, decisions (one page each)
```

## Run it

```sh
cd reference/sanity && SANITY_STUDIO_DATASET=e2e-local pnpm dev # reference, :3333; use this env for e2e too
pnpm exec sanity dataset import ../../fixtures/seed.ndjson --dataset e2e-local # seed isolated reference; never reset production
cp .env.example .env                            # BARKPARK_TOKEN (+ SANITY_TOKEN to verify the reference)
node --env-file=.env scripts/seed-barkpark.mjs  # seed + verify Barkpark studio-parity (--verify: check only)
node --env-file=.env scripts/seed-bulk.mjs      # optional J41: e2e-local datasets only; see script for overrides
cd app && pnpm install && pnpm dev              # ours, http://localhost:3000 (/structure, /health)
pnpm check                                      # typecheck + build; fails if client code imports src/server
cd ../e2e && pnpm install && pnpm test          # journeys on both studios; ours on :3100 against dataset e2e-local
pnpm reference                                # P0 crown clips, Sanity only; uses the Sanity CLI login
STUDIO_DEV_LOGIN=1 pnpm --dir ../app dev        # sign in as a seated editor (dev only; app/src/server/auth.ts)
```

`pnpm reference` records Sanity; `pnpm recording` records our built app against
`e2e-local` (requires Barkpark environment variables). Both reuse J01/J02/J08/J17/
J19/J21/J22/J23 with two-second holds after content is ready. Reports and WebM clips
live under `e2e/evidence/{reference,studio}/<run>/`. Install dependencies and `pnpm --dir e2e exec playwright install ffmpeg`. Reference auth uses
`pnpm --dir reference/sanity exec sanity login` or `SANITY_TOKEN`; credentials stay in memory.
Link reviewed clips to tasks; recording alone is not sign-off.
