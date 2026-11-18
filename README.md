[![Barkpark Studio roadmap: phases 0 to 6 and after with journeys signed off by the quality owner, and those built awaiting sign-off, out of the total; side tracks counted apart](docs/images/roadmap.svg)](docs/ROADMAP.md)

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

## News

<!-- news:start -->
**Tuesday 17 November.** Six pull requests merged, five of them new pieces of Sanity's form. A table field stores tables in Sanity's own shape, takes a paste from a spreadsheet, and keeps two editors' text out of each other's columns. A datetime field can show its time in a set zone, and the editor may switch it per field. More of Sanity's validation rules, deprecated fields, and array options that did nothing before now work as in Sanity. [The full day](docs/news/2026-11-17.md)
- **Table field:** a grid under row and column menus; paste from Excel, Sheets, Numbers or CSV; two editors in one table: text the other's change cannot place goes on a card, never into a guessed column ([#1260](https://github.com/FRIKKern/barkpark-studio/pull/1260))
- **Dates and rules:** a datetime shown in a set zone, with a zone button by the title; exact length, precision, greater or less than, casing, named and inverted patterns, date min and max, asset required ([#1273](https://github.com/FRIKKern/barkpark-studio/pull/1273), [#1274](https://github.com/FRIKKern/barkpark-studio/pull/1274))
- **Schema options:** deprecated fields show a badge and the reason; arrays take disableActions, sortable: false and an item popover ([#1275](https://github.com/FRIKKern/barkpark-studio/pull/1275), [#1271](https://github.com/FRIKKern/barkpark-studio/pull/1271))

**Monday 16 November.** Seven pull requests merged. Tick several rows in a document list and delete, duplicate or discard them in one go; a delete leaves alone, and names, a row other documents refer to. Long arrays fold after 4 items as in Sanity, the insert menu gets search, tabs and an optional grid, and the item dialog gets a tree of every item. Three reviews in a row found ways for a read-only view (a past revision, a scheduled document) to still write the draft; the check now sits where form and canvas edits are written. [The full day](docs/news/2026-11-16.md)
- **Bulk actions:** Duplicate selected, Discard changes and Delete selected for ticked rows, one row at a time with progress, Stop and Retry; references are checked again right before each delete ([#1266](https://github.com/FRIKKern/barkpark-studio/pull/1266))
- **Arrays:** insert menu search past 5 types, tabs and an optional list or grid view; Show all N items after 4; a sidebar tree in the item dialog to jump to any item, nested ones too ([#1263](https://github.com/FRIKKern/barkpark-studio/pull/1263))
- **Read-only means read-only:** a history revision, a scheduled or deleted document, or an account that cannot write: typing, Paste document, undo and edits saved on this computer no longer reach the draft ([#1263](https://github.com/FRIKKern/barkpark-studio/pull/1263), [#1268](https://github.com/FRIKKern/barkpark-studio/pull/1268), [#1269](https://github.com/FRIKKern/barkpark-studio/pull/1269))
<!-- news:end -->

## Where things live (one fact, one home)

| What | Where |
|---|---|
| Why + plan + doctrine | Paper [`barkpark-studio-parity-plan`](https://guerrilla.barkpark.cloud/papers/barkpark-studio-parity-plan) |
| Phases | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| The quality bar + test budget | [`QUALITY.md`](QUALITY.md) |
| The journeys (the spec) | [`JOURNEYS.md`](JOURNEYS.md) |
| How we work; extending it (types, desk, inputs, actions, build); deploying (own server, Vercel) | [`CONTRIBUTING.md`](CONTRIBUTING.md), [`docs/EXTENDING.md`](docs/EXTENDING.md), [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| License (Apache-2.0); ported code + their licenses | [`LICENSE`](LICENSE); [`THIRD-PARTY.md`](THIRD-PARTY.md) |
| Decisions | [`docs/decisions/`](docs/decisions/), one page each |
| Status, who does what | Barkpark tasks under goal `task-130be6b834d485ae`, mirrored to [FRIKKern/barkpark#21665](https://github.com/FRIKKern/barkpark/issues/21665). Never in docs |
| Bugs, "feels off", server gaps | [New issue](https://github.com/FRIKKern/barkpark-studio/issues/new/choose) → lands on that board ([0003](docs/decisions/0003-tracking-and-hygiene.md)) |

## Layout

```
app/                 TanStack Start studio (ours); only app/src/server/ talks to Barkpark
reference/sanity/    real Sanity Studio, the bar (project ecu57yeh, dataset production)
reference/preview-site/  the site its Presentation tool shows (J58–J64; see its README)
fixtures/            seed data + Barkpark schema, same content on both sides
e2e/                 Playwright: few, fast specs for what can break silently
scripts/             seed Barkpark, roadmap picture, doc checks
spikes/concurrent-text/  reproducible two-browser concurrency comparison (decision 0002)
```

## Run it

```sh
cd reference/sanity && SANITY_STUDIO_DATASET=e2e-local pnpm dev # reference, :3333; use this env for e2e too
pnpm exec sanity dataset import ../../fixtures/seed.ndjson --dataset e2e-local # seed isolated reference; never reset production
cp .env.example .env                            # BARKPARK_TOKEN (+ SANITY_TOKEN to verify the reference)
node --env-file=.env scripts/seed-barkpark.mjs  # seed + verify BARKPARK_DATASET (your e2e-<you>; production refused)
node --env-file=.env scripts/seed-bulk.mjs      # optional J41: e2e-local datasets only; see script for overrides
node --env-file=.env scripts/groq-conformance.mjs # read-only: ~40 Sanity queries, Sanity vs Barkpark e2e-local, pass/fail (--diff)
node --env-file=.env scripts/client-conformance.mjs # read-only: @sanity/client + image-url calls, Sanity vs Barkpark (--detail)
cd app && pnpm install && pnpm dev              # ours, http://localhost:3000 (/structure, /health)
pnpm check                                      # typecheck + build; fails if client code imports src/server
cd ../e2e && pnpm install && pnpm test          # journeys on both studios; ours on :3100 against dataset e2e-local
STUDIO_DEV_LOGIN=1 pnpm --dir ../app dev        # sign in as a seated editor (dev only; app/src/server/auth.ts)
```

`pnpm reference` records Sanity; `pnpm recording` records our built app against
`e2e-local` (requires Barkpark environment variables). Both reuse J01/J02/J08/J17/
J19/J21/J22/J23 with two-second holds after content is ready. Reports and WebM clips
live under `e2e/evidence/{reference,studio}/<run>/`. Install dependencies and `pnpm --dir e2e exec playwright install ffmpeg`. Reference auth uses `pnpm --dir reference/sanity exec sanity login` or `SANITY_TOKEN`; credentials stay in memory. Link reviewed clips to tasks; recording alone is not sign-off.
Locally with no lane token in `.e2e-lane-tokens.json`, studio and rig share one token: refs-follow.spec and refs-used-in.spec skip their live-edit timing budgets (values still checked; `sharedLocalToken`).
