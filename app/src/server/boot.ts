// Barkpark deploys blue/green: once Caddy flips to the new instance the old one drains
// for some seconds, and a stream opened before the flip stays on it, keepalives and all,
// while every write lands on the new one. Such a stream hears nothing (de6987a, 2026-10-09:
// ~25 s; the listen frames came late, replayed once the old instance closed the stream;
// 9398ab6, 2026-10-10: a presence stream missed a caret, the focus went to the new one).
// status.json says when the instance answering it booted: a new boot re-opens every stream.
import '@tanstack/react-start/server-only'

const BOOT_CHECK_MS = 5000
type Watcher = {active: () => boolean; onFlip: () => void}
const watchers = new Set<Watcher>()
let booted: number | null = null
let bootShift = 0
let timer: ReturnType<typeof setInterval> | undefined

async function check() {
  // While any stream is open: the boot the first one started on is the baseline.
  if (![...watchers].some((w) => w.active())) return
  try {
    const s = (await (await fetch(`${process.env.BARKPARK_URL}/status.json`)).json()) as {checked_at?: string; uptime_seconds?: number}
    if (!s.checked_at || typeof s.uptime_seconds !== 'number') return
    const boot = Date.parse(s.checked_at) - s.uptime_seconds * 1000 + bootShift
    if (booted !== null && Math.abs(boot - booted) > 5000) for (const w of watchers) if (w.active()) w.onFlip()
    booted = boot
  } catch {
    // Unreachable for a moment: the other checks still stand.
  }
}

/** Calls `onFlip` when Barkpark answers from a newly booted instance while `active()`; returns the unwatch. */
export function onNewBoot(onFlip: () => void, active: () => boolean = () => true) {
  const w = {active, onFlip}
  watchers.add(w)
  if (!timer) {
    timer = setInterval(check, BOOT_CHECK_MS)
    timer.unref?.()
    setTimeout(check, 0)
  }
  return () => void watchers.delete(w)
}

/** e2e (STUDIO_E2E_HOOKS=1): fake a newly booted instance. */
export const e2eFlip = () => void (bootShift += 60_000)
