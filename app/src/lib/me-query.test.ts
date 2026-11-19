// task-4ffed14fbf52dc47: the person is believed only from an answer the session made: whoAmI's
// queryFn in the browser (lib/me-query.ts). Nothing registers on the server or on hydrate.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {dehydrate, hydrate, QueryClient, QueryObserver} from '@tanstack/react-query'
import {fieldState, keptEditsWait, roleRuled, type FieldConditions} from './conditions.ts'
import {asksAgain, meQueryOf} from './me-query.ts'
import {personCheck} from './person-check.ts'
import {mint, unknown} from './persons.fixture.ts'

type Me = {email: string | null; name: string | null; userId: string | null; role: string | null; canWrite: boolean; provisional?: boolean; unchecked?: boolean}
const editor: Me = {email: 'ada@example.com', name: 'Ada', userId: 'u1', role: 'member', canWrite: true}
const adminsOnly: Record<string, FieldConditions> = {'post.title': {readOnly: ({currentUser}) => !currentUser?.roles.some((r) => r.name === 'administrator')}}
const membersOnly: Record<string, FieldConditions> = {'post.title': {readOnly: ({currentUser}) => !currentUser?.roles.some((r) => r.name === 'editor')}}
const title = {name: 'title', type: 'string'}
const client = () => new QueryClient({defaultOptions: {queries: {retry: false}}})

/** Run `f` as in a browser (a window), then as before. */
async function inBrowser<T>(f: () => Promise<T>): Promise<T> {
  const g = globalThis as {window?: unknown}
  g.window = globalThis
  try {
    return await f()
  } finally {
    delete g.window
  }
}
/** A session as lib/session.ts holds it: who-am-I on `read`, and the person as lib/person-source.ts makes it. */
function session(read: () => Promise<Me>) {
  const {query, isMade} = meQueryOf(read)
  const person = (qc: QueryClient) => {
    const me = qc.getQueryData(query.queryKey)
    return mint(isMade(me) ? me : undefined)
  }
  return {query, isMade, person, title: (qc: QueryClient, rules = membersOnly) => fieldState('post', title, {}, person(qc), rules)}
}
/**
 * A server render's answer, carried into the browser's client as the page does (dehydrate, then
 * hydrate), with a component on the page watching who-am-I (useQuery(meQuery)). Its answer is
 * fresh, so the watcher asks nothing by itself.
 */
async function served(s: ReturnType<typeof session>) {
  const server = client()
  await server.fetchQuery(s.query)
  assert.equal(s.isMade(server.getQueryData(s.query.queryKey)), false, "the server render's answer is not the session's (its render and the browser's first agree)")
  const page = client()
  hydrate(page, JSON.parse(JSON.stringify(dehydrate(server))))
  stops.push(new QueryObserver(page, s.query).subscribe(() => {}))
  return page
}
const stops: (() => void)[] = []
test.afterEach(() => stops.splice(0).forEach((stop) => stop()))
/** Until the page's who-am-I is no longer being asked. */
const settled = async (qc: QueryClient) => {
  while (qc.isFetching({queryKey: ['me']})) await new Promise((r) => setTimeout(r, 1))
}

test('nothing registers on the server or on hydrate: the answer in the page reads as unknown', async () => {
  let reads = 0
  const s = session(async () => (reads++, {...editor}))
  const page = await served(s)
  assert.equal(reads, 1)
  assert.deepEqual(page.getQueryData(s.query.queryKey), editor, 'the page holds the answer')
  assert.equal(s.person(page), unknown)
  assert.equal(s.title(page).readOnly, true, 'a role-ruled field stays closed')
})

test("the wait is one who-am-I round trip: the browser's first answer opens the field, no reload", async () => {
  let reads = 0
  const s = session(async () => (reads++, {...editor}))
  const page = await served(s)
  assert.equal(s.title(page).readOnly, true)
  // __root.tsx asks again right after load, as a role rule waits.
  assert.equal(asksAgain(page.getQueryData(s.query.queryKey), s.isMade, membersOnly), true)
  await inBrowser(() => page.invalidateQueries({queryKey: s.query.queryKey}).then(() => settled(page)))
  assert.equal(reads, 2, 'one ask in the browser')
  assert.equal(s.title(page).readOnly, false, 'open on that answer')
  assert.equal(asksAgain(page.getQueryData(s.query.queryKey), s.isMade, membersOnly), false, 'and not asked again')
})

test('a failed ask leaves the field closed, and the page says so with its Retry', async () => {
  let fail = false
  const s = session(async () => {
    if (fail) throw new Error('500')
    return {...editor}
  })
  const page = await served(s)
  fail = true
  await inBrowser(() => page.refetchQueries({queryKey: s.query.queryKey}))
  const state = page.getQueryState(s.query.queryKey)!
  assert.equal(state.status, 'error')
  assert.equal(s.title(page).readOnly, true, 'still closed')
  assert.equal(personCheck({data: state.data, made: s.isMade(state.data), isError: true, isFetching: false, waitedMs: 0}), 'failed', 'the banner shows, with Retry')
  // Retry answers: open.
  fail = false
  await inBrowser(() => page.refetchQueries({queryKey: s.query.queryKey}))
  assert.equal(s.title(page).readOnly, false)
})

test('a config with no role rule: nothing more asked on load, nothing closed, kept edits not held', async () => {
  let reads = 0
  const s = session(async () => (reads++, {...editor}))
  const page = await served(s)
  await settled(page)
  const plain: Record<string, FieldConditions> = {'post.title': {readOnly: true}, 'post.body': {hidden: false}}
  for (const rules of [undefined, {}, plain]) {
    assert.equal(asksAgain(page.getQueryData(s.query.queryKey), s.isMade, rules), false, 'no ask beyond what __root.tsx sent before')
    // The person is unknown, and no field differs from a known person's.
    assert.deepEqual(fieldState('post', title, {}, s.person(page), rules), fieldState('post', title, {}, mint(editor), rules))
    // DocumentPane's kept-edits gate (keptWait): a type with no role rule does not wait.
    assert.equal(roleRuled('post', rules) && keptEditsWait(s.person(page)), false)
  }
  assert.equal(reads, 1, 'only the server render asked')
  // A provisional answer (a late Barkpark) is asked again, as before.
  assert.equal(asksAgain({...editor, provisional: true}, s.isMade, undefined), true)
})

test("structural sharing: an unchanged answer keeps the session's object, a changed one is the fetch's own; a look-alike is never kept", async () => {
  let role = 'member'
  const s = session(async () => ({...editor, role}))
  const qc = client()
  await inBrowser(async () => {
    const first = await qc.fetchQuery(s.query)
    assert.ok(s.isMade(first))
    await qc.refetchQueries({queryKey: s.query.queryKey})
    assert.equal(qc.getQueryData(s.query.queryKey), first, 'unchanged: the same object (the person stays the same)')
    role = 'admin'
    await qc.refetchQueries({queryKey: s.query.queryKey})
    const changed = qc.getQueryData(s.query.queryKey)
    assert.notEqual(changed, first)
    assert.ok(s.isMade(changed), "changed: the fetch's own object, made by the session")
    assert.equal(s.title(qc, adminsOnly).readOnly, false)
    // A look-alike put in the cache, then the same answer fetched: the look-alike is not kept.
    const lookAlike = {...editor, role: 'admin'}
    qc.setQueryData(s.query.queryKey, lookAlike)
    await qc.refetchQueries({queryKey: s.query.queryKey})
    const after = qc.getQueryData(s.query.queryKey)
    assert.notEqual(after, lookAlike)
    assert.ok(s.isMade(after))
    // The function itself, handed a look-alike: returns what it is handed, never made.
    const share = s.query.structuralSharing as (old: unknown, next: unknown) => unknown
    assert.equal(share(lookAlike, {...lookAlike}) === lookAlike, false)
    assert.equal(s.isMade(share(first, lookAlike)), false)
  })
})

test("an answer the session made cannot be changed, and another query's answers are not the session's", async () => {
  const s = session(async () => ({...editor}))
  const qc = client()
  await inBrowser(async () => {
    const me = (await qc.fetchQuery(s.query)) as Me
    assert.throws(() => void ((me as {role: string | null}).role = 'admin'), TypeError)
    assert.equal(me.role, 'member')
    // A forger's own who-am-I query, answering an administrator: made by it, not by the session.
    const forger = meQueryOf(async (): Promise<Me> => ({...editor, role: 'admin'}))
    const forged = await client().fetchQuery(forger.query)
    assert.ok(forger.isMade(forged))
    assert.equal(s.isMade(forged), false)
    qc.setQueryData(s.query.queryKey, forged)
    assert.equal(s.person(qc), unknown)
  })
})
