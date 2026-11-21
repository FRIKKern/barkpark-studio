/**
 * Sanity's defaultSlugify (sanity 6.17): speakingurl, cut to the field's maxLength (200
 * unless set) on a word, symbols spelled out. "Blåbær på Ørsta" → blabaer-pa-orsta,
 * "Smørbrød & kaffe" → smorbrod-and-kaffe. Loaded on the first Generate, not with the
 * document pane (its transliteration tables are most of its size).
 */
export const slugify = async (value: string, maxLength = 200, table?: unknown): Promise<string> => {
  if (!value) return ''
  const own = typeof table === 'string' && Object.hasOwn(TABLES, table) ? TABLES[table] : undefined
  return own ? own(value, maxLength) : (await import('speakingurl')).default(value, {truncate: maxLength, symbols: true})
}

/**
 * The built-in tables a slug field names in `options.slugify` (task-15e2e504dd3c74cc): the
 * customer's rule as data, never code. Any other name, or none, is the default above.
 * "nb": HSO's norskSlug (src/sanity/norskSlug.ts), which wrote their imported slugs:
 * æ → ae, ø → o, å → a, other accents dropped, anything else one hyphen ("Steen & Strøm" →
 * steen-strom, where the default spells out "and"), cut at maxLength with no hyphen at the end.
 */
const TABLES: Record<string, (value: string, maxLength: number) => string> = {
  nb: (value, maxLength) =>
    value
      .toLowerCase()
      .replace(/æ/g, 'ae')
      .replace(/ø/g, 'o')
      .replace(/å/g, 'a')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength)
      .replace(/-+$/g, ''),
}
