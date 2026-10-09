#!/usr/bin/env node
// The Freeform canvas's own words in Norwegian (decision 0004: one canvas, Barkpark's).
// Barkpark's LiveView stamps them on the canvas host as `data-strings`
// (BarkparkWeb.StudioLocale.component_strings(:paper_canvas), English text → its nb
// gettext); an HTTP host gets no such map, so this copies it out of a Barkpark checkout:
//   node scripts/canvas-strings.mjs ../barkpark      # → app/src/i18n/canvas-nb.json
// Rerun when Barkpark's canvas grows words (a missing one just stays English).
import {execFileSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'

const repo = process.argv[2] ?? '../barkpark'
const show = (path) => execFileSync('git', ['-C', repo, 'show', `origin/main:${path}`], {encoding: 'utf8', maxBuffer: 1 << 26})
const ex = show('api/lib/barkpark_web/studio_locale.ex')
const start = ex.indexOf('def component_strings(:paper_canvas)')
const section = ex.slice(start, ex.indexOf('def component_strings(', start + 10))
const unquote = (s) => JSON.parse(`"${s}"`)
const keys = [...section.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*=>/gm)].map((m) => unquote(m[1]))

// msgid → msgstr from the nb .po (single-line and continued strings).
const po = show('api/priv/gettext/nb_NO/LC_MESSAGES/default.po')
const nb = new Map()
for (const entry of po.split(/\n\n+/)) {
  const grab = (tag) => {
    const m = new RegExp(`^${tag} ((?:"(?:[^"\\\\]|\\\\.)*"\\n?)+)`, 'm').exec(entry)
    return m ? [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => unquote(x[1])).join('') : undefined
  }
  const id = grab('msgid'), str = grab('msgstr')
  if (id && str) nb.set(id, str)
}
const out = Object.fromEntries(keys.flatMap((k) => (nb.has(k) && nb.get(k) !== k ? [[k, nb.get(k)]] : [])))
writeFileSync(new URL('../app/src/i18n/canvas-nb.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log(`canvas-nb.json: ${Object.keys(out).length} of ${keys.length} canvas strings have Norwegian`)
