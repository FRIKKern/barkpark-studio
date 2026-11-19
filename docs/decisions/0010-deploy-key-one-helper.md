# 0010 — The deploy key is handled in one helper

**Status:** accepted · 2026-11-19 · Task: task-5188d3dd522c19b8

```
step env DEPLOY_KEY ─► scripts/lib/deploy-push.sh: taken, unset ─► every check by the caller
   ─► deploy_push: key file (600) + GitHub's host key ─► git push (never forced) ─► files removed
                                       └ the script ends mid-push: the EXIT trap removes them
```

## Decision

- main requires its checks; `HOUSEKEEPING_DEPLOY_KEY` is the ruleset's only bypass. A workflow-token
  push starts no checks, and GitHub refuses the Actions app as a bypass on a user-owned repo.
- Two scripts push with it: `scripts/sync-act.sh` (sync-pack's `act`, [0009](0009-pack-syncs-itself.md))
  and `scripts/housekeeping-push.sh` (housekeeping's `push`, [0003](0003-tracking-and-hygiene.md)). Both
  source `scripts/lib/deploy-push.sh`, the only code that touches the key. It guarantees:
  - the key comes only from the env of the one step that runs the script (`DEPLOY_KEY`), and is unset
    at once, so no child process sees it;
  - it is a file, mode 600, only inside `deploy_push`, called after every check the caller makes; the
    file is removed after the push, and by an EXIT trap if the script ends mid-push;
  - GitHub's ed25519 host key is the only known host (no global known-hosts file, no SSH config);
  - the push is never forced; a caller may pass a lease (`--force-with-lease`).
- Every workflow job holds no key or is pinned whole, with the files it runs, in
  `scripts/lib/keyed-jobs.json` (`scripts/lib/workflow-keys.mjs`). Holding no key: every checkout keeps
  no credentials, the token may write nothing, and no secret is read but a data-only one. Both pushing
  jobs are pinned, with the helper among their files, so one changed byte in it reds both pins; every
  action in a pinned job is named by a full commit SHA.
- `scripts/lib/deploy-push.test.mjs` holds the guarantees, once. Each script's own test shows it touches
  the key nowhere but `deploy_push`, and its runs, with every external command shimmed
  (`scripts/lib/key-shims.mjs`), show no child process with the key in its env.

## Considered

- **A copy in each script.** Two copies drift; a fix to one misses the other.
- **The key on the checkout (`ssh-key:`).** Every later step, and every child process, could push.
