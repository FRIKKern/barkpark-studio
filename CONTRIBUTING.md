# Contributing

## Work

- Pick a task from the board (goal `task-130be6b834d485ae`); one journey per branch.
- `.barkpark.json` connects `bp tasks` to guerrilla. Filtering to this goal requires the CLI change in FRIKKern/barkpark#21970; older CLIs show the workspace board.
- Branch names: `feat/j21-pane-chain`, `fix/<what>`, `chore/<what>`, `docs/<what>`.
- Never switch branches in the main checkout. Use a worktree:
  `git worktree add ../barkpark-studio-<name> -b feat/<name>`, remove it after merge.
- PRs are squash-merged. The branch is deleted on merge (repo setting).
- Merge only when `gh pr checks` is green: main requires every check ([0003](docs/decisions/0003-tracking-and-hygiene.md)).
- Fill in the PR template: journey id, side-by-side done, docs in the same PR, test budget.

## Tests

- The side-by-side sign-off and the reference clip are the proof. Not a test.
- Add a test only if it is fast (< 5 s, whole e2e suite < 60 s) and guards something that can break silently (rule 5, [`QUALITY.md`](QUALITY.md)).
- Local lanes: `node --env-file=.env scripts/lane-token.mjs e2e-<lane>` once gives that dataset its own
  Barkpark tokens (rate limits are per token); `BARKPARK_DATASET=e2e-<lane> pnpm test` uses them. J48/J49 evidence (dev sign-in) also needs `scripts/rig-editor-tokens.mjs e2e-<lane>` (read-only editor d; `--revoke` after). A token minted with a `dataset` is bound to it: lane `app` and dev sign-in tokens have none (the studio switches datasets), lane `rig` and editor tokens are bound; CI's `BARKPARK_TOKEN` has none and serves all four shards (ci, ci-2, ci-3, ci-4), so re-mint it without one. Each lane also takes its own ports: `E2E_PORT`, and `PREVIEW_SITE_PORT` / `PREVIEW_SITE_PORT_BARKPARK` for the preview site's two copies (default 3536 / 3537; build with `VITE_PREVIEW_ORIGIN=http://localhost:<that port>` for `E2E_PROD`).
- Full suite, `@evidence` or audit runs: `scripts/with-lock.sh <cmd>` (ci-local's machine lock). A spec restores the fixture docs it edits.

## Docs

- One fact, one home. Link, never copy. No status in docs: it lives on the board.
- Size caps are checked in CI: `node scripts/check-docs.mjs`.
- README's timeline and `docs/images/roadmap.svg` are generated. Don't edit them.

## Bugs and "feels off"

- Something feels worse than Sanity? That is a bug. Open
  [a new issue](https://github.com/FRIKKern/barkpark-studio/issues/new/choose),
  pick "Feels off", add the journey id, a clip, and the QUALITY row.
- A missing Barkpark API: pick "Server gap". Never hack around it in the client.

## Hygiene (automatic, weekly)

- Merged branches still on the remote are deleted.
- Branches and PRs idle for more than 7 days get flagged.
- Doc size caps are checked; the run fails if one is broken.
- If GitHub Actions can't run (billing), merge only after `node scripts/ci-local.mjs` passes; paste its summary on the PR.
