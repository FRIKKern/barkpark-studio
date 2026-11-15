import {applyPatches, makePatches, stringifyPatches, type Patch} from '@sanity/diff-match-patch'
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
// A patch is not safe to send twice (a `set` is), Barkpark does not fence one (a late one is
// never refused), and it skips a hunk whose place is gone without saying so. So:
// - The answer is the truth. Whether this editor's words are in it is never guessed from how
//   alike the texts are (re-applying the patch to check typed a word twice when the other
//   editor's word sat next to it). Words go again only when a hunk provably did not land:
//   what it inserted is nowhere in the answer, or the text came back as it was.
// - A `set`, fenced as before, goes whenever the fate of an earlier write of the span is not
//   known (no answer came, a kept edit replayed after a reload), and not before the studio's
//   server has given that earlier patch up (DMP_TTL_MS, DMP_SETTLE_MS below).
// - A `set` also goes past Barkpark's limits, on a 400/422 for the patch, and from then on
//   when the server ignored one (an older Barkpark).
// Exact only with Barkpark's help (asked for, not here yet): a warning naming each skipped
// hunk, and a guard that refuses a patch landing after a later write of its span.

/**
 * A Portable Text span's text, as the write queue names it: `body[_key=="b"].children[_key=="s"].text`.
 * (Any text at `….children[_key=="…"].text` matches; a patch is right for it too.)
 */
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

const inserted = (hunk: Patch) => hunk.diffs.filter(([op]) => op === 1).map(([, text]) => text)
const afterText = (hunk: Patch) => hunk.diffs.filter(([op]) => op !== -1).map(([, text]) => text).join('')

/**
 * Whether the answer `saved` to a span's patch (`base` → `sent`) leaves it open if every hunk
 * landed. A hunk that landed left what it inserted in the answer, in one piece (the answer is
 * the text right after this patch): an insert that is nowhere in it did not land; a hunk whose
 * whole new text (context and insert) is in it did. Open is what is left: the insert is there,
 * its context is not (the other editor typed right beside it, or rewrote the place and the
 * same letters are somewhere else). Then the text just before the patch decides
 * (settleDmp's `before`), read from the document's history: one read, no write.
 */
export function landingUnsure(base: string, sent: string, saved: unknown): boolean {
  if (typeof saved !== 'string' || saved === sent || saved === base) return false
  return makePatches(base, sent).some((hunk) => inserted(hunk).length > 0 && inserted(hunk).every((text) => saved.includes(text)) && !saved.includes(afterText(hunk)))
}

/**
 * A span's patch (`base` → `sent`) was saved and Barkpark answered with the span as `saved`.
 * What this editor's text is now, measured on that answer:
 * - `value`: `saved`, plus what a hunk that did not land had inserted (after the text, as
 *   mergeText's never-drop does), with the keys typed since the save left (`typed`, made on
 *   `sent`) moved onto it. Equal to `saved`: nothing left to send.
 * - `missing`: a hunk did not land, so `value` must go as a set.
 * - `ignored`: the text came back as it was before the patch: this server does not merge.
 * Null when there is nothing to do: the answer is what was sent, or the span is gone.
 *
 * Which hunks landed is never guessed from how alike the texts are: putting words in again
 * on a guess typed them twice (two editors each adding a short word at one spot, every
 * time). With `before` (the span just before the patch), the same patch applied to it here
 * says so hunk by hunk, when it gives the answer Barkpark gave. Without it, only an insert
 * that is nowhere in the answer counts as not landed.
 */
export function settleDmp(base: string, sent: string, saved: unknown, typed?: unknown, before?: unknown): {value: string; missing: boolean; ignored: boolean} | null {
  if (typeof saved !== 'string' || saved === sent) return null
  const ignored = saved === base
  const hunks = makePatches(base, sent)
  let lost: string[] | undefined
  if (typeof before === 'string' && !ignored) {
    const [text, landed] = applyPatches(hunks, before, {allowExceedingIndices: true})
    if (text === saved && landed.length === hunks.length) lost = hunks.filter((_, i) => !landed[i]).flatMap(inserted)
    else if (text === saved && landed.every(Boolean)) lost = []
  }
  lost ??= ignored ? [] : hunks.flatMap(inserted).filter((text) => !saved.includes(text))
  const words = lost.map((text) => text.trim()).filter(Boolean)
  const whole = ignored ? sent : words.length ? `${saved} ${words.join(' ')}` : saved
  const value = typeof typed === 'string' && typed !== sent ? mergeText(sent, typed, whole) : whole
  return {value, missing: ignored || words.length > 0, ignored}
}

// A patch must not land after a later write of its span from this browser (Barkpark cannot
// refuse it: no fence covers a diffMatchPatch path). The studio's server is where a write can
// wait (a 429's Retry-After, a slow connection), so it gives a write that carries a patch up:
// not forwarded once its browser is gone or DMP_TTL_MS after it came in, never retried on a
// 429, and cut off at DMP_TTL_MS. The browser, when such a write got no answer, sends nothing
// more for that document until DMP_SETTLE_MS after it left: by then the patch has landed or
// never will, and the text goes as a fenced set.
export const DMP_TTL_MS = 2_500
export const DMP_SETTLE_MS = 4_000

/** Whether a mutate batch carries a diffMatchPatch (the server's side of the rule above). */
export const carriesPatch = (mutations: unknown): boolean =>
  Array.isArray(mutations) && mutations.some((m) => { const p = (m as {patch?: {diffMatchPatch?: unknown}} | null)?.patch?.diffMatchPatch; return !!p && typeof p === 'object' && Object.keys(p).length > 0 })

/** Whether a write that carries a patch, in the studio's server since `arrivedAt`, may still go on to Barkpark. */
export const patchMayGo = (arrivedAt: number, now: number, clientGone: boolean): boolean => !clientGone && now - arrivedAt < DMP_TTL_MS

/** When the browser may next write a document whose patch (sent at `sentAt`) got no answer. */
export const settledAt = (sentAt: number): number => sentAt + DMP_SETTLE_MS
