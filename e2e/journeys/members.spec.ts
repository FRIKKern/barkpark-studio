import {expect, test} from '../rig/test'
import {signInIfAsked, target} from '../rig/targets'

// J69 Members for admins: what can break silently is the rule a screen shows wrongly, not one
// Barkpark misses (it refuses the change anyway). Seats are real on the hosted Barkpark, so this
// writes nothing: an admin's view runs on the studio's fake roster (server/members-fake.ts, an
// e2e lever), then the real roster is read as this run's token, which may only read here (shared
// sign-in: everyone is one identity, so no seat can change).
const lever = (page: import('@playwright/test').Page, role: string | null) =>
  page.request.post('/api/e2e-listen', {data: {action: 'members-fake', role}}).then((r) => expect(r.ok(), 'members lever').toBe(true))

test('J69 members: an admin sees requests and the roster with no role above their own; the real roster only reads', async ({page, context}, info) => {
  const t = target(info)
  test.skip(t.name !== 'studio', 'ours: Sanity manages members at sanity.io/manage')
  await t.prepare(context)
  await lever(page, 'admin')
  try {
    await page.goto('/members')
    await signInIfAsked(page)
    await expect(page.getByRole('heading', {name: 'Members', level: 1})).toBeVisible()
    const request = page.getByTestId('members-request')
    await expect(request).toHaveCount(2)
    // Member by default; an admin is never offered Owner, on a request or on a seat.
    const picker = request.first().getByRole('combobox')
    await expect(picker).toHaveValue('member')
    expect(await picker.locator('option').allTextContents()).toEqual(['Administrator', 'Member', 'Contributor'])
    const owner = page.getByTestId('members-person').filter({hasText: 'Olga Owner'})
    await expect(owner.getByRole('combobox')).toHaveCount(0)
    await expect(owner.getByRole('button', {name: 'Remove Olga Owner'})).toBeDisabled()
    expect(await page.getByTestId('members-person').filter({hasText: 'ben@example.com'}).locator('option').allTextContents()).not.toContain('Owner')
    // The workspace menu has Members, with the count.
    await page.getByRole('button', {name: /^Workspace .*Switch$/}).click()
    await expect(page.getByRole('link', {name: 'Members, 2 waiting for access'})).toBeVisible()
  } finally {
    await lever(page, null)
  }
  // The real roster as this run's token: read only, and a refusal said in words, never an error screen.
  await page.goto('/members')
  await expect(page.getByTestId('members-person').first().or(page.getByTestId('members-refused'))).toBeVisible({timeout: 10_000})
  await expect(page.getByRole('button', {name: /^(Approve|Deny|Invite|Remove)/})).toHaveCount(0)
  await expect(page.getByRole('combobox')).toHaveCount(0)
})
