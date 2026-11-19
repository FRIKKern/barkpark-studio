// e2e.yml's e2e-all job: the one check name the ruleset can require for the whole e2e suite. It must need
// every other job in the file, run whatever they ended as (`if: always()`), and pass only when each ended
// exactly `success`. The last is tested by running its step as GitHub runs it (bash -e -o pipefail), with
// `needs` as GitHub would give it and a stub gh.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {fileURLToPath} from 'node:url'

import {load} from './workflow-keys.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const workflow = load(readFileSync(join(root, '.github/workflows/e2e.yml'), 'utf8'))
const gate = workflow.jobs['e2e-all']
const bin = mkdtempSync(join(tmpdir(), 'e2e-all-'))
after(() => rmSync(bin, {recursive: true, force: true}))

test('e2e-all needs every other job in e2e.yml', () => {
  assert.ok(gate, 'e2e.yml has no e2e-all job')
  const needs = [gate.needs ?? []].flat().sort()
  const others = Object.keys(workflow.jobs).filter((j) => j !== 'e2e-all').sort()
  assert.deepEqual(needs, others, 'e2e-all must need exactly the other jobs in e2e.yml')
})

test('e2e-all runs whatever the jobs it needs ended as: if: always()', () => {
  assert.equal(String(gate.if ?? '').replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1').trim(), 'always()')
})

test('e2e-all passes only when every job it needs ended exactly success', () => {
  const [step, ...rest] = gate.steps
  assert.equal(rest.length, 0, 'e2e-all has one step')
  // Either turns the check green while the verdict fails; a step `if` can skip the verdict.
  assert.equal(gate['continue-on-error'], undefined, 'e2e-all has no continue-on-error')
  assert.equal(step['continue-on-error'], undefined, 'the verdict step has no continue-on-error')
  assert.equal(step.if, undefined, 'the verdict step always runs')
  assert.equal(step.env?.NEEDS, '${{ toJSON(needs) }}', 'the step reads needs as GitHub gives it')
  // gh down: the shard listing is information only, the verdict must not lean on it.
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n')
  chmodSync(join(bin, 'gh'), 0o755)
  const run = (needs) =>
    spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
      env: {PATH: `${bin}:${process.env.PATH}`, NEEDS: JSON.stringify(needs), GITHUB_REPOSITORY: 'o/r', RUN: '1/attempts/1'},
      encoding: 'utf8',
    }).status
  const job = (result) => ({result, outputs: {}})
  assert.equal(run({studio: job('success')}), 0, 'success passes')
  assert.equal(run({studio: job('success'), more: job('success')}), 0, 'all success passes')
  for (const result of ['failure', 'skipped', 'cancelled', 'Success', '', null])
    assert.notEqual(run({studio: job(result)}), 0, `${JSON.stringify(result)} fails`)
  assert.notEqual(run({studio: job('success'), more: job('skipped')}), 0, 'one skipped among successes fails')
  assert.notEqual(run({}), 0, 'nothing needed fails')
})
