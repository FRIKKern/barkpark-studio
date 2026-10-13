import {test} from 'node:test'
import assert from 'node:assert/strict'
import {formatDate, parseDate} from './date-format.ts'

// The field-type matrix's dateFormat/timeFormat: what is shown is what reads back, and a
// day that doesn't exist never lands (a silent wrong date is the risk here).
test('formats and reads back Sanity formats', () => {
  const d = new Date(2026, 9, 13, 9, 5)
  for (const f of ['YYYY-MM-DD HH:mm', 'DD.MM.YYYY HH:mm', 'D/M/YY h:mm A', '[at] HH:mm [on] DD.MM.YYYY'])
    assert.equal(parseDate(formatDate(d, f), f)?.getTime(), d.getTime(), f)
  assert.equal(formatDate(d, 'DD.MM.YYYY'), '13.10.2026')
  assert.equal(formatDate(new Date(2026, 9, 13, 15, 30), 'h:mm a'), '3:30 pm')
})

test('refuses text that is not in the format, or a day that does not exist', () => {
  assert.equal(parseDate('2026-10-13', 'DD.MM.YYYY'), undefined)
  assert.equal(parseDate('31.02.2026', 'DD.MM.YYYY'), undefined)
  assert.equal(parseDate('13.10.2026 25:00', 'DD.MM.YYYY HH:mm'), undefined)
})
