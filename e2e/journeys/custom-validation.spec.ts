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
  } finally {
    await closeAndSettle(page)
    await bpRemove(id, 'post')
  }
})
