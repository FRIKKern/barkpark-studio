/**
 * The built-in slug tables a slug field names in `options.slugify` (task-15e2e504dd3c74cc):
 * the customer's rule as data, never code. Another locale is one more entry here. A name not
 * here (or a value that is no name) is the default slug, said once in the console, never thrown.
 */
type Table = (value: string, maxLength: number) => string

const TABLES: Record<string, Table> = {
  /**
   * HSO's norskSlug (hovinbyen-ny src/sanity/norskSlug.ts), which wrote their imported slugs:
   * æ → ae, ø → o, å → a, other accents dropped, anything else one hyphen, cut at maxLength
   * with no hyphen at the end. Where it parts from the default: "&" is a hyphen, not "and";
   * ü is u, not ue; ß and £ become a hyphen, not ss and gbp. Pinned by fixtures/slugify-nb-cases.json.
   */
  nb: (value, maxLength) =>
    value
      .toLowerCase()
      .replace(/æ/g, 'ae')
      .replace(/ø/g, 'o')
      .replace(/å/g, 'a')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength)
      .replace(/-+$/g, ''),
}

const warned = new Set<string>()

/** The table `options.slugify` names, or undefined for the default slug. */
export function slugTable(name: unknown): Table | undefined {
  if (name === undefined || name === null) return undefined
  if (typeof name === 'string' && Object.hasOwn(TABLES, name)) return TABLES[name]
  const key = typeof name === 'string' ? name : JSON.stringify(name) ?? String(name)
  if (!warned.has(key)) {
    warned.add(key)
    console.warn(`options.slugify ${key} is not a slug table this studio knows (${Object.keys(TABLES).join(', ')}): using the default slug`)
  }
  return undefined
}
