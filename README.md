# Barkpark Studio

[![Barkpark Studio roadmap: phases 0 to 6 and after, with journeys passing out of total](docs/images/roadmap.svg)](docs/ROADMAP.md)

## Vision

Editors should not notice they left Sanity. Barkpark Studio gives Barkpark the
editing feel people love in Sanity Studio: panes that open to the right without
end, references you can follow, pick, create and edit without losing your place,
typing that never waits on the network, and two people in one document, live.

We get there one journey at a time. A journey is done when it matches a real
Sanity Studio side by side, in a real browser, signed off by the quality owner.
Automated tests are few and fast, kept for what can break silently. After the
six phases come plugins and a Presentation tool (click-to-edit on the live site).

Built with TanStack Start on top of Barkpark. Why: [`docs/decisions/0001`](docs/decisions/0001-stack-and-backend.md).

## What happened

<!-- timeline:start -->
- **Today** · 9 changes, 4 tasks closed
  - feat/j01 structure shell ([#8](https://github.com/FRIKKern/barkpark-studio/pull/8))
  - Fixture: close the reference loop post -> author -> category -> post ([#7](https://github.com/FRIKKern/barkpark-studio/pull/7))
  - Done: [P0 Two-browser Playwright rig + feel budgets, proven against reference Sanity](https://github.com/FRIKKern/barkpark/issues/21666)
<!-- timeline:end -->

## Where things live (one fact, one home)

| What | Where |
|---|---|
| Why + plan + doctrine | Paper [`barkpark-studio-parity-plan`](https://guerrilla.barkpark.cloud/papers/barkpark-studio-parity-plan) |
| Phases | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| The quality bar + test budget | [`QUALITY.md`](QUALITY.md) |
| The journeys (the spec) | [`JOURNEYS.md`](JOURNEYS.md) |
| How we work | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
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
cd ../e2e && pnpm install && pnpm test          # journey specs, same steps on both studios
```
