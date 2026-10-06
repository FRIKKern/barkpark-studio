# The Quality Bar

Every journey in [`JOURNEYS.md`](JOURNEYS.md) must pass **all** rows below, side by
side with `reference/sanity`, before its task can close.

## Feel budgets

| # | Check | Bar | Sanity baseline | How it is measured |
|---|---|---|---|---|
| F1 | Keystroke → screen | < 16 ms, never waits on network | p50 12 / p95 21 ms (Event Timing p50 28 / p95 36) | rig: keydown → frame after paint |
| F2 | Pane open (warm) | < 100 ms, zero layout shift | p50 296 / p95 318 ms, CLS 0 | rig: list click → doc title shown |
| F3 | Cold load to usable list | < 1.5 s on local | not measured yet | timing mark |
| F4 | Edit seen in 2nd browser | remote push (server → other browser) p95 < 300 ms; typed edit p95 < Sanity's | push: p50 180 / p95 237 ms. Typed in A: p50 768 / p95 1104 ms | rig: two browsers, one doc |
| F5 | Keyboard | whole journey without a mouse | | Playwright, keyboard only |
| F6 | Focus | never lost or moved by a remote update | | two-browser rig asserts `activeElement` |
| F7 | Undo / redo | works across fields, across remote edits | | Playwright |
| F8 | Network blip | 10 s offline while typing → zero lost edits, visible status | | `context.setOffline` |
| F9 | Errors | none silent; every failure is visible and recoverable | | console + network assertions |
| F10 | Visual | matches the approved screenshot | | Playwright screenshot diff |
| F11 | Scale | 5k-doc list scrolls at 60 fps and keeps F2; a 200-field doc keeps F1 | | seeded dataset + perf trace |
| F12 | Narrow | at 768 and 390 px: no sideways page scroll, every journey completes, tap targets ≥ 44 px | | Playwright viewport + screenshot vs Sanity |
| F13 | Accessible | zero axe violations; Tab stays inside open dialogs; focus returns to the opener | Sanity: 5–8 axe rules fail per J01–J04 screen (2026-10-06) | @axe-core/playwright on J01–J04 screens |
| F14 | Slow network | on Fast 3G the shell paints < 2 s and every pane shows a loading state within 300 ms; never blank | | Playwright network throttling |
| F15 | Identity | an edit is never written as anyone but the signed-in editor; lost session or refused write shows the reason and stops writing | | rig: expire session / read-only token mid-edit |

The rig is [`e2e/baseline.spec.ts`](e2e/baseline.spec.ts): `cd e2e && pnpm baseline --project sanity`
(or `--project studio` for ours). Baseline = mean of two runs, 2026-10-05: production
build (`sanity build && sanity preview`), headless Chrome 1440×900 on an M-series Mac,
Sanity cloud dataset. Ours, same rig, 2026-10-05: F4 push p50 53 / p95 115 ms, typed
p50 495 / p95 512 ms (typing is coalesced to one write per 750 ms per doc while all
editors share one write budget). F4 "push" is another client patching over the API;
"typed in A" includes Sanity's own mutation batching.

## Rules

1. **Side by side or it didn't happen.** Compare against the running reference, not
   memory. The sign-off plus the reference clip is the proof a journey passes.
2. **Real browser only.** Unit tests and server tests do not count as a pass.
3. **No self-sign-off.** Whoever built a journey cannot close it. The quality owner does.
4. **Deep, not wide.** No new journey starts until the current one passes.
5. **Few, fast tests.** Add an automated test only if it is fast (< 5 s each, whole
   e2e suite < 60 s in CI) and guards something that can break silently: the crown
   journeys (J21 J08 J22 J23) and live edit (J05 J06). One spec covering several
   journeys beats many small ones. A spec that blows the budget is merged or cut.
   Specs for other journeys are tagged `@local`: `pnpm test` runs them, CI doesn't.
6. **Gaps become tasks immediately.** "Feels off" is a valid bug. File it, with a clip.

## Anti-slop rules for docs

- One fact, one home (see README table). Never copy a fact; link to it.
- No status in docs. Status is the task board and the test run.
- Size caps: README ≤ 80 lines, CONTRIBUTING ≤ 40, a decision ≤ 40 (one page),
  a journey = one table row. CI checks them (`node scripts/check-docs.mjs`).
- A doc nobody links to gets deleted.
- If code and doc disagree, the doc is the bug — fix it in the same PR.
