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
**Monday 16 November.** Nothing merged yet today.

**Sunday 15 November.** 12 pull requests merged, seven of them parts of Sanity's Studio rebuilt here: document translations, tables, a code field, incoming references, task comments, a Dashboard, and array items you can drag on the page in Presentation (the live preview of your site). Two people typing in one paragraph now both keep every word. None of the new screens was compared side by side with a running Sanity Studio; each was built from Sanity's source. [The full day](docs/news/2026-11-15.md)
- **Editing:** a Translations menu and language badge on a document; tables edited cell by cell in Portable Text (Sanity's rich text); a code field in a code editor; a form can list the documents that refer to this one ([#1256](https://github.com/FRIKKern/barkpark-studio/pull/1256), [#1254](https://github.com/FRIKKern/barkpark-studio/pull/1254), [#1257](https://github.com/FRIKKern/barkpark-studio/pull/1257), [#1255](https://github.com/FRIKKern/barkpark-studio/pull/1255))
- **Working together:** two editors in one paragraph merge on Barkpark with no lost words; tasks get comments, an activity log and Duplicate; a Dashboard shows drafts, recent edits, my tasks, schedules and who is in ([#1251](https://github.com/FRIKKern/barkpark-studio/pull/1251), [#1258](https://github.com/FRIKKern/barkpark-studio/pull/1258), [#1259](https://github.com/FRIKKern/barkpark-studio/pull/1259))
- **Presentation:** hover an outline on the page to see the document's title; right-click an array item to duplicate, remove or move it; drag it to reorder ([#1253](https://github.com/FRIKKern/barkpark-studio/pull/1253))
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
Locally with no lane token in `.e2e-lane-tokens.json`, studio and rig share one token: refs.spec skips its live-edit timing budgets (values still checked; `sharedLocalToken`).
