// The failure report of kept-edits-restore goes to a public CI log: nothing secret-shaped may
// reach it, wherever it sits in what the page sent or heard (task-a0122b1b04971f52).
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {saveReport} from './save-report.ts'

const SECRETS = {header: 'hdr-tok-1f9a', query: 'qry-tok-7c2e', body: 'body-tok-55d0', console: 'log-tok-0b31'}

test('the save report prints no header, query, body field or console line it was not told to', () => {
  const out = saveReport({
    exchanges: [
      {at: 12, method: 'POST', url: `https://studio.test/_serverFn/abc?access_token=${SECRETS.query}`, status: 200, headers: {authorization: `Bearer ${SECRETS.header}`, cookie: `sid=${SECRETS.header}`}, postData: `{"mutations":[{"patch":{"id":"author-kept-at-delete","set":{"name":"Kept Author typed","apiKey":"${SECRETS.body}"}}}]}`, responseBody: `{"token":"${SECRETS.body}"}`},
      {at: 40, method: 'GET', url: `https://studio.test/_serverFn/session?t=${SECRETS.query}`, status: 200, headers: {authorization: `Bearer ${SECRETS.header}`}, responseBody: `{"session":"${SECRETS.body}"}`},
      {at: 41, method: 'POST', url: 'https://studio.test/_serverFn/sign-in', status: 'failed', postData: `{"password":"${SECRETS.body}"}`},
    ],
    console: [`signed in with ${SECRETS.console}`, `[save] ${SECRETS.console}`],
    consolePrefixes: [],
    docId: 'author-kept-at-delete',
    values: ['Kept Author typed', 'The Kept Author typed'],
    form: {name: 'Kept Author typed', footer: 'Not saved'},
  })
  for (const [where, secret] of Object.entries(SECRETS)) assert.ok(!out.includes(secret), `the ${where} token is not in the report:\n${out}`)
  // What it is for: when each request went and what came back, and what each save carried.
  assert.match(out, /12 ms POST \/_serverFn\/abc 200 save of author-kept-at-delete: "Kept Author typed" yes, "The Kept Author typed" no/)
  assert.match(out, /41 ms POST \/_serverFn\/sign-in failed$/m)
  assert.match(out, /name: "Kept Author typed"/)
})
