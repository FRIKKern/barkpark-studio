// Sanity's relative times (useRelativeTime, minimal with its temporal phrase), in English and Norwegian.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {relativeTime} from './relative-time.ts'

const now = Date.parse('2026-10-20T12:00:00Z')
const back = (sec: number) => new Date(now - sec * 1000).toISOString()

test('relative time: just now, Intl short phrases, yesterday and last week, then the date', () => {
  const cases: [number, string | null, string | null][] = [
    [5, null, null],
    [11, '11 sec. ago', 'for 11 sek siden'],
    [180, '3 min. ago', 'for 3 min siden'],
    [5 * 3600, '5 hr. ago', 'for 5 t siden'],
    [86_400, 'yesterday', 'i går'],
    [3 * 86_400, '3 days ago', 'for 3 d. siden'],
    [8 * 86_400, 'last week', 'forrige uke'],
    [20 * 86_400, '2 wk. ago', 'for 2 u. siden'],
    [45 * 86_400, 'Sep 5', '5. sep.'],
    [400 * 86_400, 'Sep 15, 2025', '15. sep. 2025'],
  ]
  for (const [sec, en, nb] of cases) {
    assert.equal(relativeTime(back(sec), 'en-US', now), en, `en ${sec}s`)
    assert.equal(relativeTime(back(sec), 'nb-NO', now), nb, `nb ${sec}s`)
  }
})

test('relative time: a date reads the given zone (UTC while hydrating, the browser after)', () => {
  const at = '2026-09-05T20:00:00Z'
  assert.equal(relativeTime(at, 'en-US', now), 'Sep 5')
  assert.equal(relativeTime(at, 'en-US', now, 'Pacific/Kiritimati'), 'Sep 6')
  assert.equal(relativeTime(at, 'nb-NO', now, 'Pacific/Kiritimati'), '6. sep.')
})
