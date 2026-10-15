// Help > Diagnostics, Sanity's "Recent request timings": this tab's requests to the studio
// server, from the browser's own Resource Timing (nothing is tracked by hand), each in a
// series by what it asked for, and the session's n / median / p95 / max per series.

export type Sample = {series: string; at: number; ms: number}
export type SeriesSummary = {series: string; n: number; median: number; p95: number; max: number}

/** What a request to the studio's own server was for; null for what isn't a request to time. */
export function seriesOf(path: string): string | null {
  if (path.startsWith('/_serverFn/')) return 'server function'
  // The live streams stay open: their duration is how long the tab listened, not a request.
  if (/^\/api\/(?:listen|e2e-listen|vision-listen|presence)\b/.test(path)) return null
  const m = /^\/api\/([a-z-]+)/.exec(path)
  return m ? m[1]! : null
}

/** The tab's timed requests, oldest first, from performance.getEntriesByType('resource'). */
export function samplesOf(entries: {name: string; startTime: number; duration: number}[], origin: string): Sample[] {
  const out: Sample[] = []
  for (const e of entries) {
    let url: URL
    try {
      url = new URL(e.name)
    } catch {
      continue
    }
    const series = url.origin === origin ? seriesOf(url.pathname) : null
    if (series && e.duration > 0) out.push({series, at: e.startTime, ms: Math.round(e.duration)})
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Per series, most requests first: n, and the median, p95 (nearest rank) and max in ms. */
export function summarize(samples: Sample[]): SeriesSummary[] {
  const by = new Map<string, number[]>()
  for (const s of samples) by.set(s.series, [...(by.get(s.series) ?? []), s.ms])
  const rank = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!
  return [...by]
    .map(([series, ms]) => {
      const sorted = [...ms].sort((a, b) => a - b)
      return {series, n: sorted.length, median: rank(sorted, 0.5), p95: rank(sorted, 0.95), max: sorted.at(-1)!}
    })
    .sort((a, b) => b.n - a.n || a.series.localeCompare(b.series))
}
