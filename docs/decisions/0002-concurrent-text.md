# 0002 — Keep revision-checked text merging; reject whole-value last-write-wins

Date: 2026-10-07 · Task: `task-fc12b12af287527a` · Scope: plain string fields.

Keep `ifRevisionID` + client three-way diff-match-patch merging; reject whole-value
last-write-wins (LWW). Local prototype timings do not justify a Yjs relay; prioritize live latency.

## Measured evidence

Two Chrome contexts typed four characters each at 40 ms/key, at opposite ends or the same point. [Raw trials](../../spikes/concurrent-text/results-2026-10-07.json).
Preservation requires convergence and all input characters; Studio also checks persistence. Both fields remained focused at the checkpoints in all 83 trials.

| Variant / shape | Both edits preserved | Last key → convergence p50 / p95 |
|---|---:|---:|
| LWW local control: ends / same point / offline | 0/10 each | No lossless convergence |
| Yjs local: opposite ends | 10/10 | 281 / 297 ms |
| Yjs local: same point | 10/10 | 281 / 283 ms |
| Yjs local: 650 ms offline | 10/10 | 778 / 810 ms, outage included |
| Current Studio: opposite ends | 10/10 persisted | 715 / 3104 ms |
| Current Studio: same point | 10/10 persisted | 4088 / 5637 ms |
| Current Studio: 10 s offline | 3/3 persisted | Reconnect → convergence 201–225 ms |

Local controls share 200 ms debounce + 100 ms simulated fanout, not live-backend latency predictions.
Studio uses Guerrilla, an isolated test dataset,
and repeated burst traffic. Preview logs recorded repeated HTTP 429 write retries;
per-trial attribution is unavailable. This matrix does not certify overlapping deletion, undo or IME.

## Consequences and server work

Prioritize [write/presence budgets](https://github.com/FRIKKern/barkpark/issues/21708)
and [atomic draft creation](https://github.com/FRIKKern/barkpark/issues/21709); both
already have BP tasks. Measure steady editing and conflict retries before J06 closes.
Yjs preserved concurrent inserts using [binary updates](https://docs.yjs.dev/api/document-updates)
and [relative carets](https://docs.yjs.dev/api/relative-positions), but production
adoption also needs scoped auth, durable update storage/compaction, reconnect
state exchange, and a defined bridge to drafts, publish, history and undo.

Reproduce: `cd spikes/concurrent-text && pnpm install && pnpm measure` (local only).
Real app: `node measure-studio.mjs`; set `STUDIO_URL`, Barkpark credentials and `BARKPARK_DATASET=e2e-local-*`.
Output goes to `e2e/evidence/`; `node summarize.mjs` assembles the raw results.
