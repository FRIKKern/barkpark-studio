import {existsSync, readFileSync, rmSync} from 'node:fs'
import {FEEL_LOG, median} from './feel'

// Global teardown: one line per feel row from test-results/feel.jsonl (rig/feel.ts),
// so CI output shows the run's numbers next to its pass/fail. Global setup clears it.
type Row = {row: string; ms: number; label: string; where: string}
export default async function feelSummary() {
  // A dev sign-in run: sweep the editor tokens it may have left (scripts/lib/dev-tokens.mjs).
  if (process.env.STUDIO_DEV_LOGIN === '1' && process.env.BARKPARK_ADMIN_TOKEN && process.env.BARKPARK_URL) {
    const {sweepDevTokens} = await import('../../scripts/lib/dev-tokens.mjs')
    await sweepDevTokens({url: process.env.BARKPARK_URL, admin: process.env.BARKPARK_ADMIN_TOKEN})
      .then(({revoked, failed}) => (revoked || failed) && console.log(`[dev tokens] swept ${revoked}${failed ? `, ${failed} not` : ''}`))
      .catch((e) => console.warn('[dev tokens] sweep:', (e as Error).message))
  }
  if (!existsSync(FEEL_LOG)) return
  const rows = readFileSync(FEEL_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)
  for (const row of ['F1', 'F2', 'F4']) {
    const ms = rows.filter((r) => r.row === row).map((r) => r.ms)
    if (ms.length) console.log(`[feel summary] ${row}: n=${ms.length} median=${median(ms)} max=${Math.max(...ms)} ms`)
  }
}

export const clearFeelLog = () => rmSync(FEEL_LOG, {force: true})
