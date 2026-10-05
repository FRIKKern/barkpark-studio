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

1. **Side by side or it didn't happen.** Compare against the running reference, not memory.
2. **Real browser only.** Unit tests and server tests do not count as a pass.
3. **No self-sign-off.** Whoever built a journey cannot close it. The quality owner does.
4. **Deep, not wide.** No new journey starts until the current one passes.
5. **A pass is locked.** Its Playwright spec runs in CI and blocks merge forever.
6. **Gaps become tasks immediately.** "Feels off" is a valid bug. File it, with a clip.

## Anti-slop rules for docs

- One fact, one home (see README table). Never copy a fact; link to it.
- No status in docs. Status is the task board and the test run.
- Size caps: README ≤ 60 lines, a decision ≤ 1 page, a journey ≤ 10 lines.
- A doc nobody links to gets deleted.
- If code and doc disagree, the doc is the bug — fix it in the same PR.
