import {makePatches, stringifyPatches} from '@sanity/diff-match-patch'
import {mergeText} from './merge.ts'

// J06: typing in a Portable Text span goes to Barkpark as Sanity's `diffMatchPatch` (Barkpark
// #24688, 2026-10-29), so the server merges two editors' typing in one span. The save used to
// be a `set` of the whole span text, fenced on the field: the other editor's edit to the body
// cost a 412, a read and a rebase here before it went again.
//
// What each patch is measured from: the span's text as Barkpark last gave it to this browser
// (the write queue's `base`: a read, a live frame, or the answer to this editor's last save),
// to the text this editor means now. Never from a text Barkpark did not have: keys typed
// while a save is on its way wait, and go as one patch from that save's answer.
//
// A patch is not safe to send twice (a `set` is), and Barkpark skips a hunk whose place is
// gone without saying so. So a `set` still goes when: the last write of the span got no
// answer (it may have landed); the answer did not hold this editor's words (settleDmp); the
// patch is over Barkpark's limits or was refused; or the server ignored it (an older one).

/** A Portable Text span's text, as the write queue names it: `body[_key=="b"].children[_key=="s"].text`. */
export const SPAN_TEXT = /\.children\[_key=="[^"]*"\]\.text$/

// Barkpark's limits for one patch's diffMatchPatch paths together (Barkpark.Content.DiffMatchPatch
// and mutations.ex, @max_dmp_paths). Past one it answers 422; such a change goes as a set.
export const DMP_LIMITS = {patchBytes: 32_768, hunks: 100, textUnits: 20_000, paths: 32}

const bytes = (s: string) => new TextEncoder().encode(s).length

/**
 * `base` → `mine` as Sanity's patch text (stringifyPatches: `@@` headers count UTF-8 bytes),
 * with what it costs of Barkpark's limits. Null when there is nothing to patch from or to.
 */
export function spanPatch(base: unknown, mine: unknown): {text: string; bytes: number; hunks: number; units: number} | null {
  if (typeof base !== 'string' || typeof mine !== 'string' || base === mine) return null
  try {
    const patches = makePatches(base, mine)
    const text = stringifyPatches(patches)
    if (!patches.length || !text) return null
    return {text, bytes: bytes(text), hunks: patches.length, units: Math.max(base.length, mine.length)}
  } catch {
    return null // half a surrogate pair in the text: not a patch Barkpark can read
  }
}

/**
 * One save's fields, split: span texts that go as diffMatchPatch (from `base`, what Barkpark
 * had), and everything else, which goes as set/unset as before. `asSet` names the fields
 * that must not go as a patch now. A span text past the limits goes as a set too.
 */
export function splitDmp(fields: Map<string, unknown>, base: Map<string, unknown>, asSet: (field: string) => boolean = () => false): {sets: Map<string, unknown>; dmp: Record<string, string>} {
  const sets = new Map<string, unknown>()
  const dmp: Record<string, string> = {}
  const used = {bytes: 0, hunks: 0, units: 0, paths: 0}
  for (const [f, v] of fields) {
    const p = SPAN_TEXT.test(f) && !asSet(f) ? spanPatch(base.get(f), v) : null
    const fits = p && used.paths < DMP_LIMITS.paths && used.bytes + p.bytes <= DMP_LIMITS.patchBytes && used.hunks + p.hunks <= DMP_LIMITS.hunks && used.units + p.units <= DMP_LIMITS.textUnits
    if (!p || !fits) {
      sets.set(f, v)
      continue
    }
    dmp[f] = p.text
    used.bytes += p.bytes
    used.hunks += p.hunks
    used.units += p.units
    used.paths++
  }
  return {sets, dmp}
}

/**
 * A span's patch (`base` → `sent`) was saved and Barkpark answered with the span as `saved`.
 * What this editor's text is now, measured on that answer:
 * - `value`: `saved`, with whatever it lacks of `sent` put in, and the keys typed since the
 *   save left (`typed`, made on `sent`) moved onto it. Equal to `saved`: nothing left to send.
 * - `missing`: `saved` does not hold all of `sent` (a hunk had nowhere to go, or the patch
 *   was ignored), so `value` must go as a set: no word is dropped.
 * - `ignored`: the text came back as it was before the patch: this server does not merge.
 * Null when there is nothing to do: the answer is what was sent, or the span is gone.
 */
export function settleDmp(base: string, sent: string, saved: unknown, typed?: unknown): {value: string; missing: boolean; ignored: boolean} | null {
  if (typeof saved !== 'string' || saved === sent) return null
  // Someone else's words are in the answer. Mine is in there too when taking it out and
  // putting it back gives the answer again (merge3's landed check); else it is put in now.
  const whole = mergeText(base, sent, saved, true)
  const value = typeof typed === 'string' && typed !== sent ? mergeText(sent, typed, whole) : whole
  return {value, missing: whole !== saved, ignored: saved === base}
}
