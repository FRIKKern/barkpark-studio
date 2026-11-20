import {allowErrors, test} from '../rig/test'

// The rig's listener (e2e/rig/test.ts): an uncaught page error, or the studio's error
// screen, fails a test that otherwise passes; one the test allows does not. test.fail():
// these pass only because the listener fails them. Each waits for its error to have reached
// the page's events, not a fixed time: after 100 ms, a throw on a slow runner came after the
// test had ended, and the first one passed (task-0529370e1626e4ae). At most 5 s: an error that
// never comes ends the wait, the test passes, and test.fail turns that red (a timeout would
// count as the failure it expects).
const page = (html: string) => `data:text/html,${encodeURIComponent(html)}`
const THROWS = '<script>setTimeout(() => { throw new Error("deliberate") })</script>'
const WAIT = {timeout: 5_000}

test.fail('rig: an uncaught page error fails the test', async ({page: p}) => {
  const thrown = p.waitForEvent('pageerror', WAIT).catch(() => null)
  await p.goto(page(THROWS))
  await thrown
})

test.fail("rig: the studio's error screen fails the test", async ({page: p}) => {
  await p.goto(page('<main data-testid="studio-error"><h3>An error occurred</h3></main>'))
  await p.waitForFunction(() => (window as {__e2eStudioErrorTold?: boolean}).__e2eStudioErrorTold === true, null, WAIT).catch(() => null)
})

test('rig: an error the test allows does not fail it', allowErrors(/deliberate/), async ({page: p}) => {
  const thrown = p.waitForEvent('pageerror', WAIT).catch(() => null)
  await p.goto(page(THROWS))
  await thrown
})

// An error thrown as the test ends is still counted: the test returns right after the click
// that throws, and the rig hears the page out before it counts (e2e/rig/test.ts).
test.fail('rig: an error thrown as the test ends fails it', async ({page: p}) => {
  await p.goto(page('<button onclick="setTimeout(() => { throw new Error(\'deliberate, late\') })">go</button>'))
  await p.click('button')
})
