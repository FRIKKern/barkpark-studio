# Barkpark Studio

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
- **Today** · 35 changes, 12 tasks closed
  - B06: localizedText language tabs ([#64](https://github.com/FRIKKern/barkpark-studio/pull/64))
  - J41: big lists page like Sanity (100, then up to 2,000 near the bottom, then the max note); list search reaches the whole type ([#63](https://github.com/FRIKKern/barkpark-studio/pull/63))
  - J12: image upload, alt text, hotspot and crop by mouse and keyboard ([#61](https://github.com/FRIKKern/barkpark-studio/pull/61))
- **Yesterday** · 28 changes, 7 tasks closed
  - Roadmap counts every journey; Freeform track shown apart ([#28](https://github.com/FRIKKern/barkpark-studio/pull/28))
  - Freeform track: PortableDoc documents in Barkpark's shared canvas (decision 0004) ([#26](https://github.com/FRIKKern/barkpark-studio/pull/26))
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
docs/                roadmap, decisions (one page each)
```

## Run it

```sh
cd reference/sanity && pnpm dev                 # the bar, http://localhost:3333
npx sanity dataset import ../../fixtures/seed.ndjson production --replace   # reset its data
cp .env.example .env                            # BARKPARK_TOKEN (+ SANITY_TOKEN to verify the reference)
node --env-file=.env scripts/seed-barkpark.mjs  # seed + verify Barkpark studio-parity (--verify: check only)
cd app && pnpm install && pnpm dev              # ours, http://localhost:3000 (/structure, /health)
pnpm check                                      # typecheck + build; fails if client code imports src/server
cd ../e2e && pnpm install && pnpm test          # journeys on both studios; ours on :3100 against dataset e2e-local
STUDIO_DEV_LOGIN=1 pnpm --dir ../app dev        # sign in as a seated editor (dev only; app/src/server/auth.ts)
```
