import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// J40, field comments on ours (the reference can't take writes: its project is over
// its document quota; its composer and panel are the evidence clip). Comment on a
// field, the field shows the count, resolve moves it to Resolved, delete removes it.
test('@local J40: comment on a field, count, resolve, re-open, delete', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'the reference refuses writes; its read-only states are the clip')
  await t.prepare(page.context())
  await page.goto(t.docPath('post', 'post-05'))
  await signInIfAsked(page)
  await t.settle(page)
  const field = page.locator('.field:has([id="title"])')
  await field.hover()
  await field.getByRole('button', {name: 'Add comment'}).click()
  const text = `J40 ${Date.now().toString(36)}`
  await page.getByRole('textbox', {name: 'Add comment to Title'}).fill(text)
  await page.keyboard.press('Enter')
  const panel = page.getByRole('complementary', {name: 'Comments'})
  await expect(panel.getByText(text)).toBeVisible()
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
