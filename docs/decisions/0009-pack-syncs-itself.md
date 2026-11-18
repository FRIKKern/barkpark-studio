# 0009 — The PortableDoc pack syncs itself

**Status:** accepted · 2026-11-18 · Task: task-b1c18fa88841a43c (the studio's half)

```
Barkpark main: api/priv/portable_doc ── hourly, read with no token ──► pack-compare --against: same? ── yes ─► done (a leftover sync PR is closed)
                                                                          │ no
  one PR on sync/barkpark-pack ◄── push (deploy key) ◄── commit ◄── pack-sync: copy, SOURCE.md, conformance on the new pack
        │ every required check green: the next run squash-merges it by number at its head
        └ a check red: it stays open, and each hourly run fails naming the checks (the alarm)
```

## Decision

- Barkpark is the source of `conformance/pack/`. Only `scripts/pack-sync.mjs` writes it: the block
  goldens its stamp names, the stamp, `conformance.mjs` and its types, and `SOURCE.md` (the commit, and
  the sha256 of each file the stamp does not cover). `pnpm --dir app conformance` ends with
  `scripts/pack-compare.mjs`, so a hand edit in the pack fails every PR.
- `.github/workflows/sync-pack.yml` runs `scripts/pack-sync-pr.mjs` hourly and on demand, one run at a
  time, on main only, after `pack-compare --against` the Barkpark checkout. Every file the source's stamp
  names is checked against it; a source that disagrees with its stamp is refused.
- After a sync, conformance runs on the new pack. The report takes the new pack's stamp only when no row
  moved (a type the studio does not render may come or go). A moved row leaves the report as it was, so
  the sync PR's `unit` check fails: the studio renderer is behind Barkpark. Fix the renderer, or accept the
  rows on the sync branch (`pnpm --dir app conformance:write`) and say why. The job builds on the open PR's
  branch with main merged in, so such a commit stays until Barkpark moves again.
- "Behind" is checked hourly by the job, not in every PR: a PR must not go red because Barkpark merged.
- Pushes use `HOUSEKEEPING_DEPLOY_KEY`, because a push by the workflow token starts no checks. A new PR
  gets an empty commit pushed after it opens, for the same reason. The merge uses the workflow token,
  which the ruleset does not let past a red check; it fires no push run on main, as with housekeeping.
- Needs the repo setting "Allow GitHub Actions to create and approve pull requests". While it is off,
  the run that should open the PR fails and says so. No new secret.

## Considered

- **Auto-merge on the PR.** The repo has it off, and the hourly merge does the same job, an hour later.
- **Barkpark pushes here.** A cross-repo write token in Barkpark to keep and rotate; pulling needs none.
- **Rewrite the report on every sync.** A renderer falling behind would merge in silence.
