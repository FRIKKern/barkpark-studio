# Roadmap

Phases run in order. A phase is done when every journey in it passes side by
side ([`QUALITY.md`](../QUALITY.md)). Which journey belongs to which phase lives
in the Phase column of [`JOURNEYS.md`](../JOURNEYS.md). Progress in the picture
is read from the task board, never typed here.

| Phase | Name | What editors get | Exit gate |
|---|---|---|---|
| 0 | Foundation | Nothing yet. The bar becomes real numbers. | Reference Studio runs, same seed both sides, two-browser rig and budgets green against Sanity itself, live-edit spike decided |
| 1 | Panes + Refs ★ | Endless panes to the right; follow, pick, create and edit references without losing your place | Phase journeys pass; crown specs green in CI |
| 2 | Forms | Instant edits, drafts, publish, validation, field groups | Phase journeys pass |
| 3 | Live | Two people in one document, presence, offline-safe typing | Phase journeys pass; live specs green; remote edit p95 < 300 ms |
| 4 | Arrays | Add, drag and remove array items | Phase journeys pass |
| 5 | Rich text + media | Portable text body, blocks, images with crop | Phase journeys pass |
| 6 | History | Per-field diff, revert, restore | Phase journeys pass |
| after | Plugins + Presentation | Plugin API, click-to-edit preview of the live site | Own journeys, written when phase 6 closes |

★ Crown phase: built first, judged hardest.

The picture is `docs/images/roadmap.svg`, made by `node scripts/generate-roadmap.mjs`
and refreshed by CI on every push to main and once a day.
