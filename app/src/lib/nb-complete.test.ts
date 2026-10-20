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
// t, and its imported aliases (tt, tBrowser: the module-level translate for toasts and handlers).
const said = /\b(?:(?:t|tt|tBrowser)\(|translate\(\s*[\w.]+\s*,)\s*(['"])((?:\\.|(?!\1).)*)\1/g

test('B01: every t() and translate() literal has Norwegian (an nb-NO workspace sees no English)', async () => {
  const NB: Record<string, string> = {}
  for (const f of readdirSync(join(src, 'i18n/nb'))) Object.assign(NB, (await import(join(src, 'i18n/nb', f))).default)
  const missing = new Set<string>()
  for (const f of files)
    for (const m of readFileSync(f, 'utf8').matchAll(said)) {
      const en = m[2]!.replace(/\\(['"\\])/g, '$1').replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
      if (!(en in NB)) missing.add(`${en}  (${f.slice(src.length)})`)
    }
  assert.deepEqual([...missing], [])
})

// What a screen reader hears or a tooltip shows, written as a plain attribute, skips t()
// altogether: aria-label="Tasks" stayed English in nb-NO (2026-10-12 scout).
test('B01: no UI attribute is a plain English literal', () => {
  const plain = /\b(aria-label|aria-roledescription|aria-description|title|placeholder|alt|data-tip)="([^"]*[A-Za-z]{2}[^"]*)"/g
  const allowed = new Set(['URL', 'https://'])
  const found = files.filter((f) => f.endsWith('.tsx')).flatMap((f) => [...readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(plain)].filter((m) => !allowed.has(m[2]!)).map((m) => `${m[1]}="${m[2]}"  (${f.slice(src.length)})`))
  assert.deepEqual(found, [])
})
