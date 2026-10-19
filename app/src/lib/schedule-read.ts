// J40: what Barkpark's schedules list says, read without the server (schedule-read.test.ts).

export type Schedule = {_id: string; documentId: string; type: string; publishAt: string; status: string; reason?: string | null}
export type ScheduleState = {supported: boolean; schedule: Schedule | null}

/**
 * A 404 is a Barkpark without /v1/data/schedules: no Schedule action. Otherwise the
 * document's pending schedule (Barkpark keeps at most one), else its paused one (Sanity's
 * "Pause to edit", barkpark#23198), if any. The list is read with every status.
 */
export function readSchedules(status: number, body: unknown): ScheduleState {
  if (status === 404) return {supported: false, schedule: null}
  if (status < 200 || status >= 300) throw new Error(`Could not read the schedule (${status})`)
  const schedules = (body as {result?: {schedules?: Schedule[]}} | null)?.result?.schedules ?? []
  return {supported: true, schedule: schedules.find((s) => s.status === 'scheduled') ?? [...schedules].reverse().find((s) => s.status === 'paused') ?? null}
}

/**
 * The Releases list, from several reads of Barkpark's list: it answers at most 500 rows
 * and does not page, so a dataset with 500 cancelled or finished schedules pushes the
 * pending ones off `status=all` (task-3799d35d4e2c2911). Pending and paused are read on
 * their own and come first; each schedule once.
 */
export function mergeSchedules(...lists: Schedule[][]): Schedule[] {
  const byId = new Map<string, Schedule>()
  for (const s of lists.flat()) if (!byId.has(s._id)) byId.set(s._id, s)
  return [...byId.values()]
}

/**
 * One read of the list: its rows, and where the next page starts. A Barkpark that pages
 * (barkpark#23803) says `result.page.nextOffset`, null on the last page; an older one has no
 * `page`, and then there is no next page to offer (it answered its first 500 rows).
 */
export function readPage(body: unknown): {schedules: Schedule[]; next: number | null} {
  const result = (body as {result?: {schedules?: Schedule[]; page?: {nextOffset?: unknown}}} | null)?.result
  const next = result?.page?.nextOffset
  return {schedules: result?.schedules ?? [], next: typeof next === 'number' && next > 0 ? next : null}
}
