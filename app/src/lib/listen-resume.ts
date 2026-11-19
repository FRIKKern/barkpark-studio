// Where the server's listen hub (server/listen.ts) resumes Barkpark's stream: the
// Last-Event-ID it sends when it opens the stream again.
//
// Every frame that carries an id moves it on, but the welcome only does when there is
// none yet. Barkpark's welcome carries its newest event id, and on a resume it comes
// before the frames it replays. Taking it then claimed frames not yet heard: a stream
// that ended between the welcome and the end of the replay (a dropped socket, or the
// hub's own refresh) came back at the head, Barkpark replayed nothing, and the missed
// writes never reached a page (task-fe195c533c697cdb, CI run 44414126154).
// A welcome below the held id means Barkpark's log started over (a dataset seeded
// again): the held id is from the old one, so the welcome's is taken.

/** The id to resume at after a frame (`event`, `id`) arrives, holding `held` before it. */
export function resumeAt(held: string | null, event: string, id: string | null): string | null {
  if (!id) return held
  if (event !== 'welcome' || held === null) return id
  const head = Number(id)
  return Number.isFinite(head) && head < Number(held) ? id : held
}
