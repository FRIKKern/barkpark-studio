#!/usr/bin/env node
// Writes fixtures/barkpark-schema.schema.json, the JSON Schema editors check the files in
// fixtures/barkpark-schema against (.vscode/settings.json), from what the studio reads
// (app/src/lib/schema-vocab.ts). Run after changing that file; a unit test fails until then.
//   node --experimental-strip-types scripts/fixture-schema.mjs
import {writeFileSync} from 'node:fs'
import {fixtureJsonSchema} from '../app/src/lib/schema-vocab.ts'

writeFileSync(new URL('../fixtures/barkpark-schema.schema.json', import.meta.url), `${JSON.stringify(fixtureJsonSchema(), null, 2)}\n`)
