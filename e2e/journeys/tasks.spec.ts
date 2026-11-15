import {expect, test, type Page} from '../rig/test'
import {bpBase, bpDataset, bpMutate, signInIfAsked, target} from '../rig/targets'

// J66, Sanity's Tasks on ours (the reference's create form and panel are the evidence
// clip). The doc menu's "Create new task" opens the sidebar on this document; the task
// shows under Active Document, the status toggle moves it to Done, delete removes it.
test('J66: create a task on a document, see it under Active Document, mark it done, delete', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the reference refuses writes; its create form and panel are the clip')
  await t.prepare(page.context())
  // Tasks and comments are the studio's own records (declared, hidden types): not in the
  // desk's type list.
  await page.goto('/structure')
  await signInIfAsked(page)
  await t.settle(page)
  await expect(page.locator('[data-pane="types"] .type-row')).not.toHaveCount(0)
  await expect(page.locator('[data-pane="types"] .type-row', {hasText: /Studio (task|comment)/})).toHaveCount(0)
  await page.goto(t.docPath('post', 'post-05'))
  await t.settle(page)
  await page.getByRole('button', {name: 'Show document actions'}).click()
  await page.getByRole('menuitem', {name: 'Create new task'}).click()
  const panel = page.getByRole('complementary', {name: 'Tasks'})
  await panel.getByRole('button', {name: 'Create Task'}).click()
  await expect(panel.getByRole('alert')).toHaveText('Title is required')
  // The error line must not squeeze the title box (it took the form's whole height once).
  expect(await panel.getByRole('textbox', {name: 'Task title'}).first().evaluate((e) => e.clientHeight >= e.scrollHeight), 'Task title shown whole').toBe(true)
  const title = `J66 ${Date.now().toString(36)}`
  await panel.getByRole('textbox', {name: 'Task title'}).fill(title)
  await panel.getByRole('button', {name: 'Create Task'}).click()
  await expect(page.getByText('Task created')).toBeVisible()
  try {
    await expect(panel.getByRole('heading', {name: title})).toBeVisible()
    await panel.getByRole('button', {name: 'Tasks', exact: true}).click()
    await panel.getByRole('tab', {name: 'Active Document'}).click()
    const open = panel.getByRole('list', {name: 'To Do'})
    await expect(open.getByText(title)).toBeVisible()
    await open.getByRole('listitem').filter({hasText: title}).getByRole('checkbox', {name: 'Change status'}).click()
    await panel.locator('summary', {hasText: 'Done'}).click()
    await expect(panel.getByRole('list', {name: 'Done'}).getByText(title)).toBeVisible()
    // Not content: global search does not find a task (as Sanity's tasks).
    await page.keyboard.press('ControlOrMeta+k')
    await page.keyboard.type(title)
    // In the dialog: the announcer says the same words.
    const search = page.getByRole('dialog', {name: 'Search'})
    await expect(search.getByText('No results found')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(search).toBeHidden()
  } finally {
    await panel.getByRole('button', {name: title}).click()
    await deleteOpenTask(page)
    await expect(panel.getByRole('button', {name: title})).toBeHidden()
  }
})

/** The open task's menu: Delete task, and Sanity's "Delete this task?" confirmed. */
async function deleteOpenTask(page: Page) {
  await page.getByRole('complementary', {name: 'Tasks'}).getByRole('button', {name: 'Task actions'}).click()
  await page.getByRole('menuitem', {name: 'Delete task'}).click()
  await page.getByRole('dialog', {name: 'Delete this task?'}).getByRole('button', {name: 'Delete', exact: true}).click()
}

// A task's Activity, read back from the task's own revisions, with its comments (the
// documents' comment store, the task as the target) between the changes by time. The
// thread stays the task's: the target document's Comments shows none of it.
test("J66: a task's Activity lists its comment and its status change in order; Duplicate task opens a copy to create", async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "the reference's plan sells task comments and Duplicate (\"Upgrade to comment on tasks\")")
  const id = `task-j66-${Date.now().toString(36)}`
  const title = `J66 thread ${Date.now().toString(36)}`
  const auth = {authorization: `Bearer ${process.env.BARKPARK_TOKEN}`}
  const found = async (type: string, filter: string) => {
    const res = await fetch(`${bpBase()}/v1/data/query/${bpDataset()}/${type}?perspective=drafts&${filter}`, {headers: auth})
    return res.ok ? ((await res.json()) as {result: {documents: {_publishedId: string}[]}}).result.documents.map((d) => d._publishedId) : []
  }
  await bpMutate([
    {create: {_id: id, _type: 'studioTask', title, description: '', target: {_type: 'reference', _ref: 'post-05'}, targetType: 'post', assignee: null, dueAt: '2026-12-24', subscribers: [], state: 'open', createdBy: null, createdAt: new Date().toISOString()}},
    {publish: {id, type: 'studioTask'}},
  ])
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('post', 'post-05'))
    await signInIfAsked(page)
    await page.goto(`${t.docPath('post', 'post-05')}?task=${id}`)
    await t.settle(page)
    const panel = page.getByRole('complementary', {name: 'Tasks'})
    const feed = panel.getByRole('region', {name: 'Activity'}).locator('.task-feed > li')
    await expect(feed).toHaveCount(1)
    await expect(feed.first()).toContainText('created this task')
    const box = panel.getByRole('textbox', {name: 'Add a comment...'})
    await box.fill('Looks ready to me')
    await box.press('Enter')
    await expect(feed.nth(1)).toContainText('Looks ready to me')
    await expect(box).toBeFocused()
    await panel.getByRole('checkbox', {name: 'Change status'}).click()
    await expect(feed.nth(2)).toContainText('changed status to Done')
    await expect(feed).toHaveCount(3)
    // The document's own Comments: nothing of the task's thread, no count on a field.
    await page.getByRole('button', {name: 'Comments', exact: true}).click()
    await expect(page.getByRole('complementary', {name: 'Comments'}).getByText('No open comments yet')).toBeVisible()
    await expect(page.locator('.comment-count')).toHaveCount(0)
    // Duplicate: the create form, "(copy)" after the title, the same target and deadline.
    await panel.getByRole('button', {name: 'Task actions'}).click()
    await page.getByRole('menuitem', {name: 'Duplicate task'}).click()
    await expect(panel.getByRole('textbox', {name: 'Task title'})).toHaveValue(`${title} (copy)`)
    await expect(panel.locator('.task-target')).toContainText('Fixture post 05')
    await expect(panel.locator('input[id$="-due"]')).toHaveValue('2026-12-24')
    await panel.getByRole('button', {name: 'Discard'}).click()
    await expect(panel.getByRole('tab', {name: 'Assigned'})).toBeVisible()
  } finally {
    const comments = await found('studioComment', `filter[documentId][eq]=${id}`)
    const copies = await found('studioTask', `filter[title][eq]=${encodeURIComponent(`${title} (copy)`)}`)
    for (const [type, ids] of [['studioComment', comments], ['studioTask', [id, ...copies]]] as const) for (const doc of ids) await bpMutate([{delete: {id: doc, type, force: true}}]).catch(() => {})
  }
})

// A task's description typed and not left yet (it saves when the box is left) is unsaved:
// closing the tab asks first.
test('a task description typed and not saved yet asks before the tab closes', async ({context}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the reference refuses writes')
  await t.prepare(context)
  const page = await context.newPage()
  await page.goto(t.docPath('post', 'post-05'))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('button', {name: 'Show document actions'}).click()
  await page.getByRole('menuitem', {name: 'Create new task'}).click()
  const panel = page.getByRole('complementary', {name: 'Tasks'})
  const title = `Unsaved ${Date.now().toString(36)}`
  await panel.getByRole('textbox', {name: 'Task title'}).fill(title)
  await panel.getByRole('button', {name: 'Create Task'}).click()
  await expect(panel.getByRole('heading', {name: title})).toBeVisible()
  try {
    await panel.getByRole('textbox', {name: 'Add description'}).click()
    await page.keyboard.type('typed, not left')
    let asked = false
    page.once('dialog', (d) => ((asked = d.type() === 'beforeunload'), void d.dismiss()))
    await page.close({runBeforeUnload: true})
    await expect.poll(() => asked, {intervals: [50]}).toBe(true)
    await expect(panel.getByRole('textbox', {name: 'Add description'})).toHaveValue('typed, not left')
  } finally {
    await panel.getByRole('textbox', {name: 'Add description'}).blur().catch(() => {})
    await deleteOpenTask(page).catch(() => {})
    await page.close().catch(() => {})
  }
})
