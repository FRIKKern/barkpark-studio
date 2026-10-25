import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// J40, field comments on ours (the reference can't save one: its composer says 'Failed
// to send.'; its composer and mention list are the evidence clip). Comment on a field,
// the field shows the count, resolve moves it to Resolved, delete removes it.
test('@local J40: comment on a field, mention list, count, resolve, re-open, delete', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "the reference can't save a comment; its composer is the clip")
  await t.prepare(page.context())
  await page.goto(t.docPath('post', 'post-05'))
  const person = page.url().includes('/login') // a dev or account sign-in run: a person writes
  await signInIfAsked(page)
  await t.settle(page)
  const field = page.locator('.field:has([id="title"])')
  await field.hover()
  await field.getByRole('button', {name: 'Add comment'}).click()
  const text = `J40 ${Date.now().toString(36)}`
  const box = page.getByRole('textbox', {name: 'Add comment to Title'})
  // Mentions (Sanity's): "@" opens the list of users; Escape closes it and keeps the text.
  await box.pressSequentially('@')
  await expect(page.getByRole('listbox', {name: 'List of users to mention'})).toBeVisible()
  // The workspace's people are listed (it said 'No users found' while still loading).
  await expect(page.getByRole('listbox', {name: 'List of users to mention'}).getByRole('option').first()).toContainText('@')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox', {name: 'List of users to mention'})).toBeHidden()
  await box.fill(text)
  await page.keyboard.press('Enter')
  const panel = page.getByRole('complementary', {name: 'Comments'})
  await expect(panel.getByText(text)).toBeVisible()
  // The comment names its author: the signed-in person, or Studio when nobody signs in
  // (a shared-token run, as presence names it); never 'Unknown user'.
  await expect(panel.locator('.comment-item', {hasText: text}).locator('.comment-meta strong')).toHaveText(person ? 'studio-editor-a' : 'Studio')
  await expect(field.getByRole('button', {name: 'Open comments'})).toHaveText('1')
  try {
    await panel.getByRole('button', {name: 'Mark comment as resolved'}).click()
    await expect(panel.getByText('No open comments yet')).toBeVisible()
    await expect(field.getByRole('button', {name: 'Open comments'})).toBeHidden()
    await panel.getByRole('button', {name: 'Open', exact: true}).click()
    await page.getByRole('menuitemradio', {name: 'Resolved comments'}).click()
    await panel.getByRole('button', {name: 'Re-open'}).click()
    await expect(panel.getByText('No resolved comments yet')).toBeVisible()
  } finally {
    await panel.getByRole('button', {name: /^(Open|Resolved)$/}).click()
    await page.getByRole('menuitemradio', {name: 'Open comments'}).click()
    await panel.getByRole('button', {name: 'Open comment actions menu'}).first().click()
    await page.getByRole('menuitem', {name: 'Delete comment'}).click()
    await page.getByRole('dialog').getByRole('button', {name: 'Delete comment'}).click()
    await expect(panel.getByText(text)).toBeHidden()
  }
})
