import {slugTable} from './slugify.ts'

/**
 * Sanity's defaultSlugify (sanity 6.17): speakingurl, cut to the field's maxLength (200
 * unless set) on a word, symbols spelled out. "Blåbær på Ørsta" → blabaer-pa-orsta,
 * "Smørbrød & kaffe" → smorbrod-and-kaffe. Loaded on the first Generate, not with the
 * document pane (its transliteration tables are most of its size). A field's
 * `options.slugify` names a built-in table instead (./slugify.ts).
 */
export const slugify = async (value: string, maxLength = 200, table?: unknown): Promise<string> => {
  if (!value) return ''
  const own = slugTable(table)
  return own ? own(value, maxLength) : (await import('speakingurl')).default(value, {truncate: maxLength, symbols: true})
}
