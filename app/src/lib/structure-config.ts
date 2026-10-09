import studio from '../studio.config'
import type {DeskNode} from './desk'

// J18: the studio config's own structure items (Sanity's custom S.listItem()s), shown
// after the type list, or after a workspace's declared desk (B12), past a divider.
// Read when called, not at import: the config imports components that import data.

const items = () => studio.structure?.items ?? []

/** The studio's items as a desk of their own (no declared desk), or null without any. */
export function studioDesk(): DeskNode | null {
  return items().length ? {id: '__studio', type: 'list', items: items()} : null
}

/** A declared desk with the studio's items after a divider. */
export function withStudioItems(desk: DeskNode | null): DeskNode | null {
  if (!desk || !items().length) return desk
  return {...desk, items: [...(desk.items ?? []), {id: '__studio-divider', type: 'divider'}, ...items()]}
}

/** Whether a /structure URL starts at one of the studio's items. */
export function startsAtStudioItem(splat: string | undefined): boolean {
  const first = decodeURIComponent((splat ?? '').split(';')[0]?.split('|')[0]?.split(',')[0] ?? '')
  return items().some((i) => i.id === first && i.type !== 'divider')
}
