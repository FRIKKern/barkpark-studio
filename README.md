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
**Sunday 22 November.** Eight pull requests merged, seven of them in what Publish checks first. A page builder's items are now checked under the member their _type names, a strong reference inside an object, an array item or an array of references must point at a published document, and an image in a rich-text block warns when it is narrower than its minWidth. A slug check Barkpark cannot answer now holds the publish instead of reading as free, and Publish selected never publishes a draft that changed after it was judged. An array field's label lights for a problem on any item under it. [The full day](docs/news/2026-11-22.md)
- **Checks inside items:** page builder items checked under their own member; strong references in objects, items and reference arrays must point at a published document; minWidth inside rich text; the array label lights ([#1379](https://github.com/FRIKKern/barkpark-studio/pull/1379), [#1381](https://github.com/FRIKKern/barkpark-studio/pull/1381), [#1383](https://github.com/FRIKKern/barkpark-studio/pull/1383), [#1378](https://github.com/FRIKKern/barkpark-studio/pull/1378), [#1384](https://github.com/FRIKKern/barkpark-studio/pull/1384))
- **Publish holds on doubt:** a slug check Barkpark cannot answer holds the publish; Publish selected reads each draft again and holds one that changed ([#1380](https://github.com/FRIKKern/barkpark-studio/pull/1380), [#1382](https://github.com/FRIKKern/barkpark-studio/pull/1382))

**Saturday 21 November.** Twenty-eight pull requests merged, sixteen of them in what an editor or a schema author gets. A schema can now give a number field radios, start a date at "$today", hold a fixed set of documents, warn on an image narrower than a set width, make Norwegian slugs, and run a cross rule once per list item, with the problem shown on that item. A save that cannot succeed now stops and says so with the values kept, a field cleared before the first save stays empty, Publish selected holds back a draft with an error, and image and file inputs stay drawn while the editor code is late. Ten PRs are end-to-end test work. [The full day](docs/news/2026-11-21.md)
- **Schema options:** integer, number and float lists draw radios or a dropdown and store the number; "$today" starts a date at today in the workspace zone; fixedDocuments offers no new, duplicate or delete of a listed page, and a missing listed page shows as a row to create; image options.minWidth warns; options.slugify "nb" makes Norwegian slugs ([#1346](https://github.com/FRIKKern/barkpark-studio/pull/1346), [#1365](https://github.com/FRIKKern/barkpark-studio/pull/1365), [#1339](https://github.com/FRIKKern/barkpark-studio/pull/1339), [#1367](https://github.com/FRIKKern/barkpark-studio/pull/1367), [#1374](https://github.com/FRIKKern/barkpark-studio/pull/1374), [#1371](https://github.com/FRIKKern/barkpark-studio/pull/1371), [#1368](https://github.com/FRIKKern/barkpark-studio/pull/1368), [#1369](https://github.com/FRIKKern/barkpark-studio/pull/1369))
- **Cross rules:** a rule with each runs once per list item and shows its problem on that item; titles and false leaves read as Barkpark reads them ([#1340](https://github.com/FRIKKern/barkpark-studio/pull/1340), [#1363](https://github.com/FRIKKern/barkpark-studio/pull/1363), [#1373](https://github.com/FRIKKern/barkpark-studio/pull/1373))
- **Saving:** a refusal that cannot go better is final and a conflict stops after five rebases, values kept, with Retry; a field cleared before the first save stays empty; Publish selected holds a draft with an error; image and file inputs stay drawn while the editor code is late ([#1370](https://github.com/FRIKKern/barkpark-studio/pull/1370), [#1376](https://github.com/FRIKKern/barkpark-studio/pull/1376), [#1377](https://github.com/FRIKKern/barkpark-studio/pull/1377), [#1372](https://github.com/FRIKKern/barkpark-studio/pull/1372), [#1375](https://github.com/FRIKKern/barkpark-studio/pull/1375), [#1337](https://github.com/FRIKKern/barkpark-studio/pull/1337))
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
