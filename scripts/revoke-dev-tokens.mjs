#!/usr/bin/env node
// Sweep the dev sign-in's editor tokens (app/src/server/auth.ts, scripts/lib/dev-tokens.mjs):
// every live studio-editor-*@example.com token but the one each editor reuses. --all revokes
// those too and forgets them. The e2e rig's teardown runs the sweep after a dev sign-in run.
//   BARKPARK_ADMIN_TOKEN=… node --env-file=.env scripts/revoke-dev-tokens.mjs [--all]
import {sweepDevTokens} from './lib/dev-tokens.mjs'
const admin = process.env.BARKPARK_ADMIN_TOKEN || process.env.BARKPARK_TOKEN
const {revoked, failed, kept} = await sweepDevTokens({url: process.env.BARKPARK_URL, admin, everything: process.argv.includes('--all')})
console.log(`revoked ${revoked} dev editor token(s)${failed ? `, ${failed} could not be` : ''}; ${kept} kept for reuse`)
if (failed) process.exitCode = 1
