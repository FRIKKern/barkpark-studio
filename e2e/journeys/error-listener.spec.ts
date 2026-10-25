import {allowErrors, test} from '../rig/test'

// The rig's listener (e2e/rig/test.ts): an uncaught page error, or the studio's error
// screen, fails a test that otherwise passes; one the test allows does not. test.fail():
// these pass only because the listener fails them.
const page = (html: string) => `data:text/html,${encodeURIComponent(html)}`

test.fail('rig: an uncaught page error fails the test', async ({page: p}) => {
  await p.goto(page('<script>setTimeout(() => { throw new Error("deliberate") })</script>'))
  await p.waitForTimeout(100)
})

test.fail("rig: the studio's error screen fails the test", async ({page: p}) => {
  await p.goto(page('<main data-testid="studio-error"><h3>An error occurred</h3></main>'))
  await p.waitForTimeout(100)
})

test('rig: an error the test allows does not fail it', allowErrors(/deliberate/), async ({page: p}) => {
  await p.goto(page('<script>setTimeout(() => { throw new Error("deliberate") })</script>'))
  await p.waitForTimeout(100)
})
