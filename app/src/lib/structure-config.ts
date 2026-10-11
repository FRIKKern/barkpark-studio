import studio from '../studio.config'
import type {DeskNode} from './desk'

// J18: the studio config's own structure items (Sanity's custom S.listItem()s), shown
// after the type list. A workspace's declared desk replaces them (lib/desk.ts rootDesk).
// Read when called, not at import: the config imports components that import data.

const items = () => studio.structure?.items ?? []

/** The studio's items as a desk of their own (no declared desk), or null without any. */
export function studioDesk(): DeskNode | null {
  return items().length ? {id: '__studio', type: 'list', items: items()} : null
}

/** Whether a /structure URL starts at one of the studio's items. */
export function startsAtStudioItem(splat: string | undefined): boolean {
  const first = decodeURIComponent((splat ?? '').split(';')[0]?.split('|')[0]?.split(',')[0] ?? '')
  return items().some((i) => i.id === first && i.type !== 'divider')
}
