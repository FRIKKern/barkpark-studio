import {existsSync, readFileSync, rmSync} from 'node:fs'
import {FEEL_LOG, median} from './feel'

// Global teardown: one line per feel row from test-results/feel.jsonl (rig/feel.ts),
// so CI output shows the run's numbers next to its pass/fail. Global setup clears it.
type Row = {row: string; ms: number; label: string; where: string}
export default async function feelSummary() {
  if (!existsSync(FEEL_LOG)) return
  const rows = readFileSync(FEEL_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)
  for (const row of ['F1', 'F2', 'F4']) {
    const ms = rows.filter((r) => r.row === row).map((r) => r.ms)
    if (ms.length) console.log(`[feel summary] ${row}: n=${ms.length} median=${median(ms)} max=${Math.max(...ms)} ms`)
  }
}

export const clearFeelLog = () => rmSync(FEEL_LOG, {force: true})
