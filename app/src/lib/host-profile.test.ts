import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {focusCanvas} from './canvas-focus.ts'
import {focusFirstField} from './focus.ts'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const checker = path.join(repo, 'host-profile/check.mjs')
const profilePath = path.join(repo, 'host-profile/barkpark-studio.json')
const run = (profile: string) => spawnSync(process.execPath, [checker, profile], {encoding: 'utf8'})

test('barkpark-studio host profile matches the pinned editor surface', () => {
  const result = run(profilePath)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
test('canvas focus uses the public seam and preserves the connected 1.21 fallback', () => {
  const calls: string[] = []
  focusCanvas({focusSelection: () => (calls.push('public'), true), querySelector: () => ({focus: () => calls.push('legacy')})})
  focusCanvas({querySelector: (selector) => (assert.equal(selector, '.ProseMirror'), {focus: () => calls.push('legacy')})})
  assert.deepEqual(calls, ['public', 'legacy'])
})

test('first-field focus keeps the native canvas field control ahead of the public prose seam', () => {
  const original = new Map<string, PropertyDescriptor | undefined>()
  const listeners = new Map<string, EventListener>()
  let frame: FrameRequestCallback | undefined
  let active: unknown = null
  const control = {focus: () => (active = control)}
  const first = {querySelector: (selector: string) => (assert.equal(selector, '.bp-canvas-field-control'), control)}
  const canvas = {
    querySelector: (selector: string) => (assert.equal(selector, '.ProseMirror'), {firstElementChild: first}),
    contains: (node: unknown) => node != null && node === active,
    focusFirstBodyBlock: () => assert.fail('the prose seam must not replace native field focus'),
  }
  const pane = {
    querySelector: (selector: string) => selector === 'bp-paper-canvas' ? canvas : null,
    contains: (node: unknown) => node != null && node === active,
  }
  const globals = {
    document: {
      get activeElement() { return active },
      querySelector: (selector: string) => (assert.equal(selector, '[data-pane="doc:doc-1"]'), pane),
    },
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    requestAnimationFrame: (callback: FrameRequestCallback) => (frame = callback, 1),
  }
  try {
    for (const [name, value] of Object.entries(globals)) {
      original.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
      Object.defineProperty(globalThis, name, {configurable: true, writable: true, value})
    }
    focusFirstField('doc-1')
    assert.equal(active, control)
    listeners.get('keydown')?.({} as Event)
    frame?.(performance.now())
  } finally {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete (globalThis as Record<string, unknown>)[name]
    }
  }
})

test('barkpark-studio host profile rejects an undeclared member', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'barkpark-studio-host-profile-'))
  try {
    const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {root: string; uses: Record<string, Record<string, string[]>>}
    profile.root = repo
    for (const uses of Object.values(profile.uses)) {
      for (const [kind, names] of Object.entries(uses)) {
        if (kind === 'member') uses[kind] = names.filter((name) => name !== 'focusSelection')
      }
    }
    const altered = path.join(dir, 'barkpark-studio.json')
    writeFileSync(altered, JSON.stringify(profile))
    const result = run(altered)
    assert.equal(result.status, 1)
    assert.match(result.stdout, /undeclared .* focusSelection/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

