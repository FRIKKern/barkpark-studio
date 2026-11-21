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
**Friday 20 November.** Fourteen pull requests merged, five of them in what an editor sees. The studio now shows a schema's cross-field rules as you type, with Barkpark's own answers, including rules that compare two fields or ask for exactly one; field conditions such as visibleWhen give Barkpark's answers too. A Restore that cannot put a kept edit back says why and shows the kept text to copy, and a refused people list no longer brings up "Trying to connect…" on every load. Seven test PRs swap fixed waits for waits on events and make resets cheaper; one cut that could hang was undone within the hour. [The full day](docs/news/2026-11-20.md)
- **Field rules:** cross_validations show under each field they name as you type, at the rule's level, and in the Validation list; gt, gte, lt, lte, valueField and one, as Barkpark answers them; visibleWhen and readOnly conditions match Barkpark ([#1336](https://github.com/FRIKKern/barkpark-studio/pull/1336), [#1338](https://github.com/FRIKKern/barkpark-studio/pull/1338))
- **Editing:** a Restore that cannot put an edit back says why, shows the kept text to copy, and Discard drops only what the card shows; a 401 or 403 on the people list is final, with no "Trying to connect…"; a just-made document's field marks are the same in the server's page and the first paint ([#1320](https://github.com/FRIKKern/barkpark-studio/pull/1320), [#1333](https://github.com/FRIKKern/barkpark-studio/pull/1333), [#1325](https://github.com/FRIKKern/barkpark-studio/pull/1325))
- **Tests:** fixed waits wait for their event, resets after each test cost about 3.75 s less per suite run, and a cut that could hang was undone; one e2e-all check passes only when every shard succeeded ([#1326](https://github.com/FRIKKern/barkpark-studio/pull/1326), [#1328](https://github.com/FRIKKern/barkpark-studio/pull/1328), [#1330](https://github.com/FRIKKern/barkpark-studio/pull/1330), [#1331](https://github.com/FRIKKern/barkpark-studio/pull/1331), [#1329](https://github.com/FRIKKern/barkpark-studio/pull/1329), [#1332](https://github.com/FRIKKern/barkpark-studio/pull/1332), [#1335](https://github.com/FRIKKern/barkpark-studio/pull/1335), [#1324](https://github.com/FRIKKern/barkpark-studio/pull/1324))

**Thursday 19 November.** Thirty-three pull requests merged, fourteen of them in what an editor sees. A rich text field can be kept to one line, a studio can hide a field or make it read-only by the editor's role, and the form, both pastes, the Freeform canvas and the save follow that one rule. Two people pasting into one rich-text block both keep their text once, and typing or deleting while the other's paste splits the block keeps every word once; some mixed edits still merge wrong, and that work goes on. An array at its maximum stops offering ways to add, and open pages no longer miss the newest changes when the live connection drops during catch-up. [The full day](docs/news/2026-11-19.md)
- **Rich text:** options.oneLine keeps a field to one line, for typing, pasting, dictation and Android; two people pasting into one block both keep their text once, and typing or deleting while the other's paste splits it keeps every word once; Restore after a reload puts a kept line back beside the other's paste ([#1291](https://github.com/FRIKKern/barkpark-studio/pull/1291), [#1302](https://github.com/FRIKKern/barkpark-studio/pull/1302), [#1304](https://github.com/FRIKKern/barkpark-studio/pull/1304), [#1297](https://github.com/FRIKKern/barkpark-studio/pull/1297), [#1310](https://github.com/FRIKKern/barkpark-studio/pull/1310), [#1314](https://github.com/FRIKKern/barkpark-studio/pull/1314), [#1318](https://github.com/FRIKKern/barkpark-studio/pull/1318))
- **Fields by role:** hidden and readOnly callbacks get the editor's role, as Sanity's; a paste never writes a field hidden from you but shown to another role, custom roles too; fields stay closed until Studio knows your role, with Retry ([#1288](https://github.com/FRIKKern/barkpark-studio/pull/1288), [#1301](https://github.com/FRIKKern/barkpark-studio/pull/1301), [#1298](https://github.com/FRIKKern/barkpark-studio/pull/1298), [#1306](https://github.com/FRIKKern/barkpark-studio/pull/1306), [#1312](https://github.com/FRIKKern/barkpark-studio/pull/1312))
- **Arrays and live:** at Rule.max, Add item, Duplicate and Add before/after are off, and a paste or file drop that would pass the max is refused; a dropped live connection during catch-up no longer skips the newest changes ([#1292](https://github.com/FRIKKern/barkpark-studio/pull/1292), [#1299](https://github.com/FRIKKern/barkpark-studio/pull/1299))
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
