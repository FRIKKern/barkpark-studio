// D12: a paper's metadata sidebar, after Barkpark's LiveView Studio
// (api/lib/barkpark_web/live/studio/studio_live/paper_canvas.ex, "t6" sidebar).
// Metadata lives beside the body, never in it: a sidebar edit is a doc-field edit.

/** Types that open with the paper sidebar: Bulldocs' PortableDoc paper. */
export const PAPER_TYPES = new Set(['paper'])

export type Tone = 'ok' | 'warn' | 'danger'

/** Instant slug format check (LiveView's `slug_feedback/1`): lowercase words joined by hyphens. */
export function slugFeedback(slug: string): {tone: Tone; message: string} {
  if (slug === '') return {tone: 'warn', message: 'Slug is required'}
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return {tone: 'ok', message: 'Looks good'}
  if (/[A-Z]/.test(slug)) return {tone: 'danger', message: 'Lowercase only — no capitals'}
  if (/\s/.test(slug)) return {tone: 'danger', message: 'No spaces — use hyphens'}
  if (/(^-|-$|--)/.test(slug)) return {tone: 'warn', message: 'No leading, trailing, or doubled hyphens'}
  return {tone: 'danger', message: 'Only lowercase letters, numbers, and hyphens'}
}

export type WeightedTag = {tag: string; strength?: number; rationale?: string}
export type LabelEntry = {name: string; strength: number | null; rationale: string | null; main: boolean; index: number}

/**
 * The Labels list (LiveView's `paper_label_entries/1`): weighted `{tag, strength,
 * rationale}` entries and legacy plain strings, strongest first, legacy last, document
 * order within ties; `main` marks the one named by `main_tag` (any case). `index` is
 * the entry's place in the stored array.
 */
export function labelEntries(tags: unknown, mainTag: unknown): LabelEntry[] {
  if (!Array.isArray(tags)) return []
  const main = typeof mainTag === 'string' ? mainTag.trim().toLowerCase() : null
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  return tags
    .map((t, index) => {
      const name = typeof t === 'string' ? t : t && typeof t === 'object' ? (t as WeightedTag).tag : undefined
      if (typeof name !== 'string' || !name.trim()) return null
      const w: Partial<WeightedTag> = typeof t === 'object' ? (t as WeightedTag) : {}
      return {name, strength: typeof w.strength === 'number' ? w.strength : null, rationale: text(w.rationale), main: name.trim().toLowerCase() === main, index}
    })
    .filter((e): e is LabelEntry => e !== null)
    .sort((a, b) => (a.strength === null ? 1 : 0) - (b.strength === null ? 1 : 0) || (b.strength ?? 0) - (a.strength ?? 0))
}

/** A new label, checked the way the publish wall checks an entry (LiveView's `sidebar_label_add`). */
export function checkLabel(tag: string, strength: string, rationale: string): {entry: Required<WeightedTag>} | {error: string} {
  const name = tag.trim()
  const why = rationale.trim()
  const n = /^\d+$/.test(strength.trim()) ? Number(strength.trim()) : NaN
  if (!name) return {error: 'A label needs a tag name.'}
  if (!(n >= 1 && n <= 100)) return {error: "A label's strength must be a whole number from 1 to 100."}
  if (why.length < 20) return {error: 'A label needs a rationale of at least 20 characters — say why this tag fits.'}
  return {entry: {tag: name, strength: n, rationale: why}}
}
