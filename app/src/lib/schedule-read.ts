// J40: what Barkpark's schedules list says, read without the server (schedule-read.test.ts).

export type Schedule = {_id: string; documentId: string; type: string; publishAt: string; status: string; reason?: string | null}
export type ScheduleState = {supported: boolean; schedule: Schedule | null}

/**
 * A 404 is a Barkpark without /v1/data/schedules: no Schedule action. Otherwise the
 * document's pending schedule (Barkpark keeps at most one), if any.
 */
export function readSchedules(status: number, body: unknown): ScheduleState {
  if (status === 404) return {supported: false, schedule: null}
  if (status < 200 || status >= 300) throw new Error(`Could not read the schedule (${status})`)
  const schedules = (body as {result?: {schedules?: Schedule[]}} | null)?.result?.schedules ?? []
  return {supported: true, schedule: schedules.find((s) => s.status === 'scheduled') ?? null}
}

/** `datetime-local` wants the local time, minute precision: 2026-10-20T10:00. */
export const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
