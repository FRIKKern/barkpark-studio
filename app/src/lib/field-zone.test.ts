import {test} from 'node:test'
import assert from 'node:assert/strict'
import {calendarView, fieldZone, fieldZoneName, instantIn, listedLocal, onZoneStep, shownIn, typedIn, wallIn, zoneKey, zoneKeyId, zoneList, zoneMatches, zoneOptions, zoneScope} from './field-zone.ts'

// A datetime field's options.displayTimeZone and allowTimeZoneSwitch, as Sanity's (sanity 6.17
// DateTimeInput.tsx, useTimeZone.tsx, DialogTimeZone.tsx; @sanity/util legacyDateFormat parse).
// The DST edges are what Sanity's TZDate (@date-fns/tz 1.5) answered in computer zones UTC,
// Europe/Oslo, America/New_York and Asia/Tokyo alike.

const F = 'YYYY-MM-DD HH:mm'

test('a wall time in a zone maps to its UTC instant and back, DST included', () => {
  // Typed in the box, as the input reads and shows it.
  assert.equal(typedIn('2026-07-01 09:00', F, 'America/New_York'), '2026-07-01T13:00:00.000Z')
  assert.equal(shownIn('2026-07-01T13:00:00.000Z', F, 'America/New_York'), '2026-07-01 09:00')
  // The same instant in another zone: only the shown time moves.
  assert.equal(shownIn('2026-07-01T13:00:00.000Z', F, 'Europe/Oslo'), '2026-07-01 15:00')
  // Spring forward: 02:30 never happens in New York on 8 March; Sanity's moves on by the gap, 03:30 EDT.
  assert.equal(typedIn('2026-03-08 02:30', F, 'America/New_York'), '2026-03-08T07:30:00.000Z')
  assert.equal(shownIn('2026-03-08T07:30:00.000Z', F, 'America/New_York'), '2026-03-08 03:30')
  // Fall back: 01:30 happens twice on 1 November; Sanity's takes the first, 01:30 EDT.
  assert.equal(typedIn('2026-11-01 01:30', F, 'America/New_York'), '2026-11-01T05:30:00.000Z')
  assert.equal(typedIn('2026-11-01 02:00', F, 'America/New_York'), '2026-11-01T07:00:00.000Z')
  // Oslo's gap, a half-hour offset, and Lord Howe's half-hour gap.
  assert.equal(instantIn({year: 2026, month: 3, day: 29, hour: 2, minute: 30}, 'Europe/Oslo').toISOString(), '2026-03-29T01:30:00.000Z')
  assert.equal(instantIn({year: 2026, month: 1, day: 1, hour: 9, minute: 0}, 'Asia/Kolkata').toISOString(), '2026-01-01T03:30:00.000Z')
  assert.equal(instantIn({year: 2026, month: 10, day: 4, hour: 2, minute: 15}, 'Australia/Lord_Howe').toISOString(), '2026-10-03T15:45:00.000Z')
  assert.deepEqual(wallIn(new Date('2026-01-01T00:00:00Z'), 'Pacific/Kiritimati'), {year: 2026, month: 1, day: 1, hour: 14, minute: 0, second: 0})
  // The time step is the shown zone's grid; a day that doesn't exist stays unread.
  assert.equal(typedIn('2026-07-01 09:07', F, 'Asia/Kolkata', 15), '2026-07-01T03:30:00.000Z')
  assert.equal(onZoneStep(new Date('2026-07-01T13:07:00Z'), 1, 'America/New_York').toISOString(), '2026-07-01T13:07:00.000Z')
  assert.equal(typedIn('2026-02-29 09:00', F, 'America/New_York'), undefined)

  // The scope key of drafts.post-1 field 'at', as Sanity's; .fixed with switching off.
  assert.equal(zoneScope('drafts.post-1', 'at', true), 'post-1.at')
  assert.equal(zoneScope('drafts.post-1', 'at', false), 'post-1.at.fixed')
  assert.equal(zoneScope('versions.r1.post-1', 'items[_key=="a1"].at', true), 'post-1.items.key-a1.at')
  assert.equal(zoneKeyId('list[2].at'), 'list.idx_2.at')
  assert.equal(zoneKey('post-1.at'), 'studio.timezone.input.post-1.at')
  assert.notEqual(zoneKey('post-1.at'), 'studio.timezone.content-releases')
})

test("the button, the zone shown and the zone list are Sanity's", () => {
  assert.deepEqual(zoneOptions({displayTimeZone: 'America/New_York'}), {display: 'America/New_York', allowSwitch: true, button: true})
  assert.deepEqual(zoneOptions({allowTimeZoneSwitch: true}), {display: undefined, allowSwitch: true, button: true})
  assert.deepEqual(zoneOptions({displayTimeZone: 'Europe/Oslo', allowTimeZoneSwitch: false}), {display: 'Europe/Oslo', allowSwitch: false, button: true})
  // No zone option: no button, the field stays in local time as before.
  assert.equal(zoneOptions({}).button, false)
  const warn = console.warn
  console.warn = () => {}
  assert.equal(zoneOptions({displayTimeZone: 'Mars/Olympus'}).display, undefined)
  console.warn = warn

  const july = new Date('2026-07-01T12:00:00Z')
  const list = zoneList(july, 'en-US')
  const ny = list.find((z) => z.name === 'America/New_York')!
  assert.deepEqual(ny, {name: 'America/New_York', city: 'New York', namePretty: 'America/New York', abbreviation: 'EDT', alternativeName: 'Eastern Daylight Time', offset: '-4'})
  assert.equal(list.find((z) => z.name === 'Australia/Adelaide')!.offset, '+9:30')
  assert.equal(list.find((z) => z.name === 'America/Argentina/Salta')?.city, 'Argentina')
  assert.ok(!list.some((z) => z.name === 'UTC'))
  // Ordered by offset, west to east.
  assert.ok(list.indexOf(ny) < list.findIndex((z) => z.name === 'Europe/Oslo'))
  // Named at the field's date: New York in January is Eastern Standard Time, GMT-5.
  assert.equal(zoneList(new Date('2026-01-15T12:00:00Z'), 'en-US').find((z) => z.name === 'America/New_York')!.offset, '-5')
  // Search: city, offset and long name, not the zone's id.
  assert.ok(zoneMatches(ny, 'new y') && zoneMatches(ny, 'gmt-4') && zoneMatches(ny, 'eastern daylight'))
  assert.ok(!zoneMatches(ny, 'America/'))
  // The pick wins, then the field's zone, then this computer's (a computer in UTC: the first GMT).
  assert.equal(fieldZone(list, 'Europe/Oslo', 'America/New_York', 'Asia/Tokyo')!.name, 'Europe/Oslo')
  assert.equal(fieldZone(list, null, 'America/New_York', 'Asia/Tokyo')!.name, 'America/New_York')
  assert.equal(fieldZone(list, 'Nowhere/Gone', undefined, 'Asia/Tokyo')!.name, 'Asia/Tokyo')
  assert.equal(listedLocal(list, 'UTC')!.abbreviation, 'GMT')
  // The box's zone by name alone: the same order.
  assert.equal(fieldZoneName('Europe/Oslo', 'America/New_York', 'Asia/Tokyo'), 'Europe/Oslo')
  assert.equal(fieldZoneName(null, 'UTC', 'Asia/Tokyo'), 'Asia/Tokyo')
})

test("the calendar's day and time read on the field's clock, even in the hour this computer skips", () => {
  const tz = process.env.TZ
  try {
    // An Oslo computer: 02:00-03:00 on 29 March 2026 never happens here, but 02:30 New York (06:30Z) does.
    process.env.TZ = 'Europe/Oslo'
    const stored = new Date('2026-03-29T06:30:00.000Z')
    const v = calendarView(stored, 'America/New_York')
    assert.equal(v.time, '02:30')
    assert.deepEqual([v.day.getFullYear(), v.day.getMonth(), v.day.getDate()], [2026, 2, 29])
    // Picking the selected day again (day + time box, as the calendar's withTime) stores the same instant.
    const [h, m] = v.time.split(':').map(Number)
    assert.equal(instantIn({year: v.day.getFullYear(), month: v.day.getMonth() + 1, day: v.day.getDate(), hour: h!, minute: m!}, 'America/New_York').toISOString(), stored.toISOString())
    // A Santiago computer skips its midnight on 6 September 2026: New York's 00:30 there stays 00:30, on the 6th.
    process.env.TZ = 'America/Santiago'
    const s = calendarView(new Date('2026-09-06T04:30:00.000Z'), 'America/New_York')
    assert.equal(s.time, '00:30')
    assert.equal(s.day.getDate(), 6)
    // No zone of its own: the computer's clock, the instant itself as the day (as before).
    process.env.TZ = 'Asia/Tokyo'
    const local = calendarView(new Date('2026-07-01T13:00:00.000Z'))
    assert.equal(local.time, '22:00')
    assert.equal(local.day.getTime(), Date.parse('2026-07-01T13:00:00.000Z'))
  } finally {
    if (tz === undefined) delete process.env.TZ
    else process.env.TZ = tz
  }
})
