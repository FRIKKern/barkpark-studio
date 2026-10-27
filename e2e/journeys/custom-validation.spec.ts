import {expect, test} from '../rig/test'
import {bpMutate, bpRemove, closeAndSettle, signInIfAsked, target} from '../rig/targets'

// task-01b4134d487dd298: Sanity's Rule.custom from the studio config (app/src/studio.config.tsx,
// as reference/sanity/schemaTypes/post.ts): a document rule gates Publish, and a rule answering
// with a Promise holds it ("Validating…") until its answer. Studio only. A scratch post, removed after.
test('custom rules: a document rule gates Publish; an async rule says Validating… then its answer', async ({page}, info) => {
  const t = target(info)
  test.skip(t.name === 'sanity', 'ours: the studio config')
  const id = `post-custom-${Date.now().toString(36)}`
  await bpMutate([{createOrReplace: {_id: id, _type: 'post', title: 'Custom rules', slug: id, featured: true}}])
  try {
    await t.prepare(page.context())
    await page.goto(t.docPath('post', id))
    await signInIfAsked(page)
    await t.settle(page)
    const publish = page.getByRole('button', {name: 'Publish', exact: true}).last()
    // The document rule: featured, no excerpt.
    await expect(publish).toBeDisabled()
    await page.getByRole('button', {name: 'Validation'}).first().click()
    const panel = page.getByRole('complementary', {name: 'Validation'})
    await expect(panel).toContainText('A featured post needs an excerpt')
    await t.field(page, 'excerpt').fill('Now it has one.')
    await expect(panel).not.toContainText('A featured post needs an excerpt')
    // The async rule: Validating… (Publish held), then its answer.
    await page.getByRole('tab', {name: /^Meta/}).click()
    await t.field(page, 'featuredNote').fill('TODO: check')
    await expect(publish).toHaveAttribute('aria-busy', 'true')
    await expect(publish).toBeDisabled()
    await expect(panel).toContainText('Remove the TODO before publishing')
    await expect(publish).not.toHaveAttribute('aria-busy')
    // task-4090c58c3d43fe67: an edit keeps the last answer until the next one, as Sanity's: on
    // no frame does the error leave the panel or Publish come back on (it said "No validation
    // errors" and lit Publish for ~300 ms).
    await panel.evaluate((list) => {
      const w = window as unknown as {lost?: number}
      w.lost = 0
      const pub = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Publish').pop()!
      const until = performance.now() + 1500
      const frame = () => {
        if (!list.isConnected || !list.textContent?.includes('Remove the TODO before publishing') || !pub.disabled) w.lost!++
        if (performance.now() < until) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    await t.field(page, 'featuredNote').press('End')
    await page.keyboard.type(' again')
    await page.waitForTimeout(1600)
    expect(await page.evaluate(() => (window as unknown as {lost: number}).lost)).toBe(0)
    await expect(panel).toContainText('Remove the TODO before publishing')
    // task-17c587477e6bfe1c: picking a problem is a step in history, as Sanity's: the URL names
    // the field (path=featuredNote, so a reload or a copied link lands on it), and Back undoes only that.
    await t.field(page, 'reviewNote').click()
    await expect(page).toHaveURL(/[,;]path=reviewNote(?:[,&]|$)/)
    await panel.getByRole('button').filter({hasText: 'Remove the TODO before publishing'}).click()
    await expect(page).toHaveURL(/[,;]path=featuredNote(?:[,&]|$)/)
    await expect(t.field(page, 'featuredNote')).toBeFocused()
    await page.goBack()
    await expect(page).toHaveURL(/[,;]path=reviewNote(?:[,&]|$)/) // the field before the jump
    await expect(panel).toBeVisible()
  } finally {
    await closeAndSettle(page)
    await bpRemove(id, 'post')
  }
})
