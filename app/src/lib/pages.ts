// Read every page of an offset-paged Barkpark list (`next_offset`, null on the last one),
// at most `max` pages. Pure, so the paging has a fast test (pages.test.ts).
export async function allPages<T>(page: (offset: number) => Promise<{items: T[]; next: number | null | undefined}>, max = 25): Promise<T[]> {
  const out: T[] = []
  for (let offset: number | null = 0, n = 0; offset !== null && n < max; n++) {
    const {items, next} = await page(offset)
    out.push(...items)
    offset = next ?? null
  }
  return out
}
