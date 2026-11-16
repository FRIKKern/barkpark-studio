import {expect, test, type Page} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// J66's Tasks (tasks.spec), an unsaved description; split from it for CI's shards
// (task-c1df532bed870536).

/** The open task's menu: Delete task, and Sanity's "Delete this task?" confirmed. */
async function deleteOpenTask(page: Page) {
  await page.getByRole('complementary', {name: 'Tasks'}).getByRole('button', {name: 'Task actions'}).click()
  await page.getByRole('menuitem', {name: 'Delete task'}).click()
  await page.getByRole('dialog', {name: 'Delete this task?'}).getByRole('button', {name: 'Delete', exact: true}).click()
}

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
