// Help > What's new, inside the studio as Sanity's (scout 2026-10-15; it opened the README on
// GitHub): the latest merged pull requests, read from git when the studio is built
// (vite.config.ts), so the list is this build's and needs no network.

export type Change = {date: string; title: string; pr: number}

/**
 * `git log --first-parent --format=%cs%x09%s` → the merged pull requests, newest first: a
 * subject that names its PR ("… (#625)"), its conventional-commit type dropped (the scope
 * kept). Merges, reverts and housekeeping (chore, [skip ci]) are left out.
 */
export function parseChanges(log: string, max = 12): Change[] {
  const out: Change[] = []
  for (const line of log.split('\n')) {
    const [date, subject = ''] = line.split('\t')
    const pr = /\s\(#(\d+)\)$/.exec(subject)?.[1]
    if (!date || !pr || /^(?:chore|Merge |Revert )/.test(subject) || subject.includes('[skip ci]')) continue
    // "fix(auth): signing out …" reads "Auth: signing out …"; with no scope, the rest alone.
    const conventional = /^\w+(?:\(([^)]*)\))?!?:\s*/.exec(subject)
    const rest = subject.slice(conventional?.[0].length ?? 0).replace(/\s\(#\d+\)$/, '')
    const title = conventional?.[1] ? `${conventional[1]}: ${rest}` : rest
    out.push({date, title: title.charAt(0).toUpperCase() + title.slice(1), pr: Number(pr)})
    if (out.length === max) break
  }
  return out
}
