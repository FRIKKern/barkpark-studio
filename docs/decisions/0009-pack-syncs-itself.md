# 0009 — The PortableDoc pack syncs itself

**Status:** accepted · 2026-11-18 · Task: task-b1c18fa88841a43c (the studio's half)

```
plan (no key, read-only token): Barkpark main api/priv/portable_doc ── daily ──► a file other than the stamp differs?
   │ no: done (a stamp-only difference rides along; a leftover sync PR is closed)      │ yes
   │                                    pack-sync: copy, SOURCE.md, conformance ◄──────┘
   ▼ the sync commit as a bundle
act (deploy key, installs and runs nothing): the commit touches only the pack ─► push sync/barkpark-pack, open or update the PR
   └ every required check green: the next run squash-merges it at its head, then starts main's checks
```

## Decision

- Barkpark is the source of `conformance/pack/`. Only `scripts/pack-sync.mjs` writes it: the block
  goldens its stamp names, the stamp, `conformance.mjs` and its types, and `SOURCE.md`. `pnpm --dir app
  conformance` ends with `scripts/pack-compare.mjs`: a committed file the pack does not name, or one not as
  the sync wrote it, fails every PR. Uncommitted files git ignores (a `.DS_Store`) are skipped.
- `.github/workflows/sync-pack.yml` runs once a day and on demand, on main only. A source that disagrees
  with its own stamp is refused. Barkpark's stamp alone changes several times a day (gettext and render
  versions); such a change opens no PR, the run summary names it, and the next real change carries it.
- Two jobs. `plan` installs the app and runs `scripts/pack-sync-pr.mjs`, which writes nothing to GitHub.
  `act` has the deploy key and trusts nothing `plan` hands it. It finds the sync PR itself, checks the
  bundle, the commit's parent (main, or with the PR open its head with main merged in) and both sides of
  every changed path (plain files under the pack or its report), then pushes that branch. After a keyed
  checkout every workflow runs only git, gh, jq, sleep and shell built-ins (a unit test reads them all).
- Conformance runs on the new pack; the report takes the new stamp only when no row moved, else the PR's
  `unit` fails (the renderer is behind). Fix the renderer, or accept the rows on the sync branch
  (`conformance:write`) and say why; the next sync builds on that branch, so the commit stays.
- Pushes use `HOUSEKEEPING_DEPLOY_KEY`: a workflow-token push starts no checks (a new PR gets an empty
  commit after it opens). The merge uses the workflow token, which the ruleset holds to green checks, then
  dispatches `unit` and `e2e` on main. Needs "Allow GitHub Actions to create and approve pull requests"
  on; while it is off, the run that should open the PR fails and says so. No new secret.

## Considered

- **Hourly.** Most hours would carry a stamp-only change: a full e2e run and a main merge for nothing.
- **Barkpark pushes here.** A cross-repo write token in Barkpark to keep and rotate; pulling needs none.
- **Rewrite the report on every sync.** A renderer falling behind would merge in silence.
