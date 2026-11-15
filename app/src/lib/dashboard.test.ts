import {test} from 'node:test'
import assert from 'node:assert/strict'
import {dashboardEnabled, DEFAULT_WIDGETS, docRows, draftsToCheck, dueState, memberRows, membersRefused, openTasks, orderExpr, resolveWidgets, upcoming, withFrame, withoutFrame, type RowsKind, type WidgetConfig} from './dashboard.ts'
import type {Doc} from './data.ts'
import type {Task} from './tasks.ts'

// The Dashboard tool's pure parts: when it is on, what a config's widgets become, and what
// each widget shows of what it read.

test('the tool is on with a dashboard in the config, unless the deployment names its tools without it', () => {
  assert.equal(dashboardEnabled({}), false)
  assert.equal(dashboardEnabled({dashboard: {}}), true)
  // VITE_STUDIO_TOOLS="structure,vision": no navbar entry and no /dashboard.
  assert.equal(dashboardEnabled({dashboard: {}, navbarTools: ['structure', 'vision']}), false)
  assert.equal(dashboardEnabled({dashboard: {}, navbarTools: ['structure', 'dashboard']}), true)
  assert.equal(dashboardEnabled({navbarTools: ['dashboard']}), false)
})

test('no widgets in the config: the default five, each with its title, width and limit', () => {
  const widgets = resolveWidgets({})
  assert.deepEqual(widgets.map((w) => w.kind), ['drafts', 'recent', 'tasks', 'scheduled', 'members'])
  assert.deepEqual(widgets.map((w) => w.kind), DEFAULT_WIDGETS.map((w) => ('type' in w ? w.type : '')))
  assert.deepEqual(widgets[0], {kind: 'drafts', key: 'drafts', title: 'Unpublished changes', limit: 6, width: 'medium'})
  assert.equal(resolveWidgets(undefined).length, 5)
  // An empty list is the config's word: a dashboard with nothing on it.
  assert.deepEqual(resolveWidgets({widgets: []}), [])
})

test("a config's widgets: Sanity's document list, a custom component, limits kept within 1 to 25", () => {
  const Custom = () => null
  const widgets = resolveWidgets({
    widgets: [
      {type: 'documentList', title: 'Latest posts', types: ['post'], order: '_createdAt desc', limit: 5, createNew: true},
      {type: 'documentList', types: ['post', 'author'], order: '_updatedAt:desc', limit: 500},
      {type: 'documentList'},
      {type: 'recent', title: '  ', limit: 0, layout: {width: 'full'}},
      {name: 'guide', component: Custom, layout: {width: 'large'}},
      {name: 'broken'} as unknown as WidgetConfig,
      {type: 'nope'} as unknown as WidgetConfig,
      null as unknown as WidgetConfig,
    ],
  })
  assert.deepEqual(widgets[0], {kind: 'documentList', key: 'list-post', title: 'Latest posts', types: ['post'], order: '_createdAt desc', limit: 5, createNew: true, createButtonText: undefined, width: 'medium'})
  // Barkpark's order spelling reads as GROQ's; two types have no one type to create; the limit is capped.
  assert.deepEqual([widgets[1]!.kind === 'documentList' && widgets[1].order, widgets[1]!.kind === 'documentList' && widgets[1].createNew, widgets[1]!.kind === 'documentList' && widgets[1].limit, widgets[1]!.title], ['_updatedAt desc', false, 25, 'Last edited'])
  // Sanity's defaults: every type, last created, ten rows.
  assert.deepEqual(widgets[2], {kind: 'documentList', key: 'list-all', title: 'Last created', types: null, order: '_createdAt desc', limit: 10, createNew: false, createButtonText: undefined, width: 'medium'})
  assert.deepEqual(widgets[3], {kind: 'recent', key: 'recent', title: 'Recently edited', limit: 1, width: 'full'})
  assert.deepEqual(widgets[4], {kind: 'custom', key: 'custom-guide', title: undefined, component: Custom, width: 'large'})
  // What the studio cannot draw is left out, and the rest still shows.
  assert.equal(widgets.length, 5)
  // Two of a kind are two widgets.
  assert.deepEqual(resolveWidgets({widgets: [{type: 'recent'}, {type: 'recent'}]}).map((w) => w.key), ['recent', 'recent-2'])
})

test('an order is GROQ the server can run, or the default: never what a config typed as it is', () => {
  assert.equal(orderExpr('_updatedAt desc'), '_updatedAt desc')
  assert.equal(orderExpr('title'), 'title asc')
  assert.equal(orderExpr('publishedAt:desc, title asc'), 'publishedAt desc, title asc')
  assert.equal(orderExpr('_updatedAt desc) | {"x": *[_type == "secret"]'), '_createdAt desc')
  assert.equal(orderExpr(undefined), '_createdAt desc')
})

const raw = (id: string, at: string, more: Record<string, unknown> = {}) => ({_id: id, _type: 'post', _rev: 'r', _updatedAt: at, title: id, ...more})

test('rows from a raw read: one per document, the draft in front, marked as lists mark theirs', () => {
  const read = [raw('drafts.b', '05'), raw('a', '04'), raw('b', '03'), raw('drafts.c', '02'), raw('drafts.d', '01'), raw('e', '00')]
  // The second read asks only for the drafts whose published version the first did not hold.
  assert.deepEqual(draftsToCheck(read), ['c', 'd'])
  const rows = docRows(read, {c: {_updatedAt: '2026-01-01'}}, 4)
  assert.deepEqual(rows.map((d) => [d._id, d._publishedId, d._draft, d._hasPublished, d._publishedAt]), [
    ['drafts.b', 'b', true, true, '03'],
    ['a', 'a', false, true, '04'],
    ['drafts.c', 'c', true, true, '2026-01-01'],
    ['drafts.d', 'd', true, false, undefined],
  ])
  // A published version met first gives its place to the draft met after it.
  assert.deepEqual(docRows([raw('a', '09'), raw('drafts.a', '08', {title: 'draft words'})], {}, 5).map((d) => [d._id, d.title, d._hasPublished]), [['drafts.a', 'draft words', true]])
})

test('last created: a draft of an old document is not a new document', () => {
  // Barkpark creates the draft when editing begins: its own _createdAt is that moment.
  const read = [raw('drafts.old', '09', {_createdAt: '2026-11-15'}), raw('new', '05', {_createdAt: '2026-11-01'}), raw('drafts.fresh', '04', {_createdAt: '2026-10-20'}), raw('mid', '03', {_createdAt: '2026-10-01'})]
  const rows = docRows(read, {old: {_updatedAt: '01', _createdAt: '2026-01-01'}}, 3, '_createdAt desc')
  assert.deepEqual(rows.map((d) => [d._publishedId, d._createdAt]), [['new', '2026-11-01'], ['fresh', '2026-10-20'], ['mid', '2026-10-01']])
})

const row = (id: string, at: string, draft = false, more: Partial<Doc> = {}): Doc => ({_id: draft ? `drafts.${id}` : id, _publishedId: id, _type: 'post', _draft: draft, _rev: 'r', _updatedAt: at, _hasPublished: true, ...more})
const recent: RowsKind = {only: 'all', types: ['post', 'author'], order: '_updatedAt desc', limit: 3}
const drafts: RowsKind = {...recent, only: 'drafts'}

test('a live frame goes into Recently edited with no read: on top, once, the list still its length', () => {
  const rows = [row('a', '03'), row('b', '02'), row('c', '01')]
  // Someone types in b: its draft is the first row, b is there once.
  const typed = withFrame(rows, row('b', '04', true, {_hasPublished: undefined, title: 'typed'}), recent)!
  assert.deepEqual(typed.map((d) => [d._publishedId, d._draft, d._hasPublished]), [['b', true, true], ['a', false, true], ['c', false, true]])
  // The same frame again (a replay) changes nothing: no duplicate.
  assert.deepEqual(withFrame(typed, row('b', '04', true, {_hasPublished: undefined}), recent)!.map((d) => d._publishedId), ['b', 'a', 'c'])
  // A publish of a document not among the rows: on top, the last row gives way.
  assert.deepEqual(withFrame(rows, row('z', '09'), recent)!.map((d) => d._publishedId), ['z', 'a', 'b'])
  // An older frame than the row (a late replay) is not put over it.
  assert.equal(withFrame(rows, row('a', '01', true), recent), rows)
  // Not this widget's type (a task, a comment): the same rows, nothing redrawn.
  assert.equal(withFrame(rows, {...row('t', '09'), _type: 'studioTask'}, recent), rows)
  // A draft never seen, published or not unknown: only a read can tell.
  assert.equal(withFrame(rows, row('n', '09', true, {_hasPublished: undefined}), recent), null)
})

test('a live frame in Unpublished changes: a draft comes in, a publish takes its row out', () => {
  const rows = [row('a', '03', true), row('b', '02', true)]
  assert.deepEqual(withFrame(rows, row('b', '05', true, {_hasPublished: undefined}), drafts)!.map((d) => d._publishedId), ['b', 'a'])
  // b is published: no longer an unpublished change.
  assert.deepEqual(withFrame(rows, row('b', '06'), drafts)!.map((d) => d._publishedId), ['a'])
  // A publish of something that was no row leaves the rows as they are.
  assert.equal(withFrame(rows, row('z', '06'), drafts), rows)
  // A full list that loses a row has another draft to show: read again.
  assert.equal(withFrame([...rows, row('c', '01', true)], row('b', '06'), drafts), null)
  // A discard or a delete: read again only when the document was a row.
  assert.equal(withoutFrame(rows, 'drafts.a'), null)
  assert.equal(withoutFrame(rows, 'z'), rows)
})

test('a list in its own order: a row is redrawn where it stands, anything else is read again', () => {
  const created: RowsKind = {only: 'all', types: ['post'], order: '_createdAt desc', limit: 3}
  const rows = [row('a', '03'), row('b', '02')]
  assert.deepEqual(withFrame(rows, row('b', '09', true, {_hasPublished: undefined, title: 'new'}), created)!.map((d) => [d._publishedId, d.title]), [['a', undefined], ['b', 'new']])
  assert.equal(withFrame(rows, row('z', '09'), created), null)
  // A full list of the last created: an edit to an older document is not its business (no read), a newer document is.
  const full = [row('a', '03', false, {_createdAt: '2026-03'}), row('b', '02', false, {_createdAt: '2026-02'}), row('c', '01', false, {_createdAt: '2026-01'})]
  assert.equal(withFrame(full, row('old', '09', false, {_createdAt: '2025-12'}), created), full)
  assert.equal(withFrame(full, row('new', '09', true, {_hasPublished: undefined, _createdAt: '2026-04'}), created), null)
  // A row redrawn keeps its document's creation time, not its draft's.
  assert.equal(withFrame(full, row('b', '09', true, {_hasPublished: undefined, _createdAt: '2026-11'}), created)![1]!._createdAt, '2026-02')
  assert.equal(withFrame(rows, row('b', '09'), {...created, order: 'title asc'}), null)
})

const task = (id: string, more: Partial<Task>): Task => ({_id: id, title: id, state: 'open', createdAt: '2026-11-01', ...more})

test('My tasks: open tasks assigned to me, the soonest deadline first; shared sign-in lists every open one', () => {
  const tasks = [
    task('late', {assignee: 'me@x.io', dueAt: '2026-11-20'}),
    task('none', {assignee: 'me@x.io'}),
    task('soon', {assignee: 'me@x.io', dueAt: '2026-11-16'}),
    task('theirs', {assignee: 'you@x.io', dueAt: '2026-11-01'}),
    task('done', {assignee: 'me@x.io', state: 'done'}),
    // PR #1258: a task still being written is a draft, never a row.
    task('unwritten', {assignee: 'me@x.io', state: 'draft' as Task['state']}),
  ]
  assert.deepEqual(openTasks(tasks, 'me@x.io', 2), {rows: [tasks[2], tasks[0]], total: 3})
  assert.deepEqual(openTasks(tasks, null, 9).rows.map((x) => x._id), ['theirs', 'soon', 'late', 'none'])
  assert.deepEqual([dueState('2026-11-14', '2026-11-15'), dueState('2026-11-15', '2026-11-15'), dueState('2026-11-16', '2026-11-15'), dueState(null, '2026-11-15')], ['overdue', 'today', 'later', 'none'])
})

test('Scheduled: what is still to run, the soonest first', () => {
  const s = (id: string, publishAt: string, status = 'scheduled') => ({_id: id, documentId: id, type: 'post', publishAt, status})
  const all = [s('c', '2026-12-03'), s('x', '2026-11-01', 'completed'), s('a', '2026-12-01'), s('p', '2026-11-30', 'paused'), s('b', '2026-12-02')]
  assert.deepEqual(upcoming(all, 2), {rows: [all[2], all[4]], total: 3})
})

test('Members: you and who is online first, then by name; a refused read is the empty state', () => {
  const {rows, total, onlineCount} = memberRows(['zoe@x.io', 'ada@x.io', 'bo@x.io', 'me@x.io'], {'zoe@x.io': 'Zoe Z'}, ['ZOE@x.io '], 'me@x.io', 3)
  assert.deepEqual(rows.map((m) => [m.name, m.online, m.you]), [['me', true, true], ['Zoe Z', true, false], ['ada', false, false]])
  assert.deepEqual([total, onlineCount], [4, 2])
  assert.equal(membersRefused(new Error('Could not load the users (403)')), true)
  assert.equal(membersRefused(new Error('Could not load the users (500)')), false)
})
