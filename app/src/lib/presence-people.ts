// J07, as Sanity: presence is shown per person, not per tab. Barkpark's room has an
// entry per session (a person with two tabs is two entries, each its own colour); a
// person here is everyone under one name, drawn in their first session's colour, at
// the place they moved to last.

type Session = {sessionId: string; name: string; color: string; documentId: string | null; field: string | null}

export type Person<P extends Session = Session> = P & {sessions: number}

/** One per name, in first-seen order; `seen` (session → when it last moved) picks where each one is. */
export function people<P extends Session>(sessions: P[], seen: ReadonlyMap<string, number> = new Map()): Person<P>[] {
  const byName = new Map<string, P[]>()
  for (const s of sessions) byName.set(s.name, [...(byName.get(s.name) ?? []), s])
  return [...byName.values()].map((all) => {
    const latest = [...all].sort((a, b) => (seen.get(b.sessionId) ?? 0) - (seen.get(a.sessionId) ?? 0))
    const at = latest.find((s) => s.documentId) ?? latest[0]!
    return {...at, color: all[0]!.color, sessions: all.length}
  })
}

/**
 * Sanity hides the current user's presence, all their tabs. With account (or dev) sign-in
 * the studio knows their presence name; with shared sign-in every tab is one identity
 * and none is left out.
 */
export function withoutSelf<P extends Session>(sessions: P[], self: string | null | undefined): P[] {
  return self ? sessions.filter((s) => s.name !== self) : sessions
}

/**
 * Sanity's avatar stack: up to `max` people show; past that, `max - 1` of them (the last)
 * and a counter of the rest before them. A counter is never 1: then all `max` show.
 */
export function stack<T>(items: T[], max: number): {hidden: number; shown: T[]} {
  const hidden = items.length > max ? items.length - (max - 1) : 0
  return hidden > 1 ? {hidden, shown: items.slice(hidden)} : {hidden: 0, shown: items}
}
