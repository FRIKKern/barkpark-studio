import {expect, test} from '@playwright/test'
import {signInIfAsked, target} from '../rig/targets'

// Sanity's intent links (other tools, old bookmarks): /intent/edit opens the document in
// its type's list, with or without the type; /intent/create starts a new one from the
// template and its parameters (base64 JSON), here "Post by author" with Alan Turing.
// @local: a link that lands wrong shows on screen (CI's 5 s per journey rule).
test('@local intent links: edit and create (with a template) open in Structure', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', "ours: Sanity's own intents are the reference")
  await t.prepare(page.context())
  await page.goto('/intent/edit/id=post-03')
  await signInIfAsked(page)
  await expect(page).toHaveURL(/\/structure\/post;post-03$/)
  await expect(t.field(page, 'title')).toHaveValue('Fixture post 03')
  // No write: a new document exists only on screen until its first edit.
  await page.goto(`/intent/create/template=post-by-author;type=post/${Buffer.from(JSON.stringify({authorId: 'author-alan'})).toString('base64')}`)
  await expect(page).toHaveURL(/\/structure\/post;[0-9a-f-]{36}/)
  await expect(page.locator('.field').filter({hasText: 'Author'}).first()).toContainText('Alan Turing')
})
