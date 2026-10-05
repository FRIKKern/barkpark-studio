# The Quality Bar

Every journey in [`JOURNEYS.md`](JOURNEYS.md) must pass **all** rows below, side by
side with `reference/sanity`, before its task can close.

## Feel budgets

| # | Check | Bar | How it is measured |
|---|---|---|---|
| F1 | Keystroke → screen | < 16 ms, never waits on network | Playwright trace, input→paint |
| F2 | Pane open (warm) | < 100 ms, zero layout shift | timing mark + CLS = 0 |
| F3 | Cold load to usable list | < 1.5 s on local | timing mark |
| F4 | Edit seen in 2nd browser | p95 < 300 ms | two-browser rig |
| F5 | Keyboard | whole journey without a mouse | Playwright, keyboard only |
| F6 | Focus | never lost or moved by a remote update | two-browser rig asserts `activeElement` |
| F7 | Undo / redo | works across fields, across remote edits | Playwright |
| F8 | Network blip | 10 s offline while typing → zero lost edits, visible status | `context.setOffline` |
| F9 | Errors | none silent; every failure is visible and recoverable | console + network assertions |
| F10 | Visual | matches the approved screenshot | Playwright screenshot diff |

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
6. **Gaps become tasks immediately.** "Feels off" is a valid bug. File it, with a clip.

## Anti-slop rules for docs

- One fact, one home (see README table). Never copy a fact; link to it.
- No status in docs. Status is the task board and the test run.
- Size caps: README ≤ 80 lines, CONTRIBUTING ≤ 40, a decision ≤ 40 (one page),
  a journey = one table row. CI checks them (`node scripts/check-docs.mjs`).
- A doc nobody links to gets deleted.
- If code and doc disagree, the doc is the bug — fix it in the same PR.
