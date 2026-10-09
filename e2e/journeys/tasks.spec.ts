import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J66, Sanity's Tasks on ours (the reference's create form and panel are the evidence
// clip). The doc menu's "Create new task" opens the sidebar on this document; the task
// shows under Active Document, the status toggle moves it to Done, delete removes it.
test('J66: create a task on a document, see it under Active Document, mark it done, delete', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the reference refuses writes; its create form and panel are the clip')
  await t.prepare(page.context())
  await page.goto(t.docPath('post', 'post-05'))
  await signInIfAsked(page)
  await t.settle(page)
  await page.getByRole('button', {name: 'Show document actions'}).click()
  await page.getByRole('menuitem', {name: 'Create new task'}).click()
  const panel = page.getByRole('complementary', {name: 'Tasks'})
  await panel.getByRole('button', {name: 'Create Task'}).click()
  await expect(panel.getByRole('alert')).toHaveText('Title is required')
  const title = `J66 ${Date.now().toString(36)}`
  await panel.getByRole('textbox', {name: 'Task title'}).fill(title)
  await panel.getByRole('button', {name: 'Create Task'}).click()
  await expect(page.getByText('Task created')).toBeVisible()
  try {
    await expect(panel.getByRole('heading', {name: title})).toBeVisible()
    await panel.getByRole('button', {name: 'Tasks', exact: true}).click()
    await panel.getByRole('tab', {name: 'Active Document'}).click()
    const open = panel.getByRole('list', {name: 'Open'})
    await expect(open.getByText(title)).toBeVisible()
    await open.getByRole('listitem').filter({hasText: title}).getByRole('checkbox', {name: 'Change status'}).click()
    await panel.locator('summary').click()
    await expect(panel.getByRole('list', {name: 'Done'}).getByText(title)).toBeVisible()
  } finally {
    await panel.getByRole('button', {name: title}).click()
    await panel.getByRole('button', {name: 'Delete task'}).click()
    await expect(panel.getByRole('button', {name: title})).toBeHidden()
  }
})
