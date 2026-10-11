# 0003 — Tracking, issues and repo hygiene

**Status:** accepted · 2026-10-05

## Decision

- **One ledger: Barkpark tasks** under goal `task-130be6b834d485ae`. The Barkpark
  GitHub bridge already mirrors every task as a sub-issue of
  [FRIKKern/barkpark#21665](https://github.com/FRIKKern/barkpark/issues/21665),
  with `status:*` labels and the acceptance criteria in the body. We add no
  milestones and no hand-made issues in this repo. That would be a second ledger.
- **New reports go through the bridge.** This repo's "New issue" page has no blank
  issues, only two links ("Feels off", "Server gap") that open a pre-filled issue
  in FRIKKern/barkpark. The bridge turns it into an intake task, which is adopted
  under the goal. The bridge is wired to one repo, so that is where reports land.
- **Progress data comes from the mirrored issues**, read with the GitHub API.
  FRIKKern/barkpark is public, so CI needs no Barkpark token. Code:
  `scripts/lib/board.mjs`.
- **Generated, not hand-kept:** the README timeline (`scripts/readme-timeline.mjs`)
  and `docs/images/roadmap.svg` (`scripts/generate-roadmap.mjs`). The
  `housekeeping` Action rebuilds both on push to main and daily, and commits only
  when the output changed.
- **Hygiene:** squash merge only, branch auto-deleted on merge. A weekly job deletes
  merged branches left behind, comments on PRs idle for 7+ days, lists idle branches
  without a PR, and fails if a doc breaks its size cap.

## Why

- A read-only Barkpark token in CI would be one more secret to mint, store and
  rotate, for data the bridge already publishes. The mirror lags the board by
  seconds and only carries open/closed plus a status label. That is all we need.
- main requires `check`, `unit` and every `studio` shard (ruleset "main:
  required checks", 2026-10-09). Housekeeping pushes with a deploy key, the
  ruleset's only bypass (GitHub refuses the Actions app on a user-owned repo).
- No loop: the commit carries `[skip ci]`, so its push starts no workflow runs.

## Open

- If the bridge learns to mirror per repo, move reports into this repo's issues.
