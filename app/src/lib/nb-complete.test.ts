import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, readdirSync, statSync} from 'node:fs'
import {join} from 'node:path'

// B01: every English string the Studio says through t('…') or translate(locale, '…')
// has its Norwegian. A literal without one would show in English in an nb-NO workspace
// and nothing else would notice ('just now' did, 2026-10-09 scout).
const src = new URL('..', import.meta.url).pathname
const files: string[] = []
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) f !== 'i18n' && walk(p)
    else if (/\.tsx?$/.test(f) && !f.includes('.test.')) files.push(p)
  }
}
walk(src)
const said = /\b(?:t\(|translate\(\s*[\w.]+\s*,)\s*(['"])((?:\\.|(?!\1).)*)\1/g

test('every t() and translate() literal has Norwegian', async () => {
  const NB: Record<string, string> = {}
  for (const f of readdirSync(join(src, 'i18n/nb'))) Object.assign(NB, (await import(join(src, 'i18n/nb', f))).default)
  const missing = new Set<string>()
  for (const f of files)
    for (const m of readFileSync(f, 'utf8').matchAll(said)) {
      const en = m[2]!.replace(/\\(['"\\])/g, '$1')
      if (!(en in NB)) missing.add(`${en}  (${f.slice(src.length)})`)
    }
  assert.deepEqual([...missing], [])
})
