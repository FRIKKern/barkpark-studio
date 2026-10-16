// A number field's text, read in the studio's language (Sanity's number input reads it in
// the machine's). Norwegian writes the decimal with a comma ("1,5"); English with a point,
// where "1,500" is one thousand five hundred: a comma there is not read as the point (it
// would turn 1,500 into 1.5), the text is not a number, and the field stays unset.

const separators: Record<string, string> = {}
/** The decimal separator of a BCP-47 locale tag: "," for nb-NO, "." for en-US. */
export const decimalSeparator = (tag: string) =>
  (separators[tag] ??= new Intl.NumberFormat(tag).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.')

/** The number typed, or NaN. With a comma decimal, a comma reads as the point; a point still works. */
export function parseNumber(text: string, decimal: string): number {
  const s = text.trim()
  if (s.includes(',')) return decimal === ',' && s.split(',').length === 2 ? Number(s.replace(',', '.')) : NaN
  return Number(s)
}

/** What is typed on the way to a number ("-", "1," in a comma locale): kept in the field until it is one. */
export const typingNumber = (text: string, decimal: string) => new RegExp(`^-?[.${decimal === ',' ? ',' : ''}]?$`).test(text.trim())
