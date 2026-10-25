// STUDIO_DESK_ID: which published `deskStructure` document this deployment's desk is. Two
// studios on one dataset each show their own desk: the default reads `deskStructure`, a second
// deployment names its own (`deskStructure.pensum`), same type and shape. A published id only:
// letters, digits, `_`, `.`, `-`, never a `drafts.` copy. Anything else is refused
// (server/schemas.ts) rather than show another studio's desk.
export const DEFAULT_DESK_ID = 'deskStructure'
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/

export function deskId(value: string | undefined): string {
  const id = value?.trim()
  if (!id) return DEFAULT_DESK_ID
  if (!ID.test(id) || id.startsWith('drafts.')) throw new Error(`STUDIO_DESK_ID "${id}" is not a published document id: letters, digits, _ . - and no drafts. prefix (docs/DEPLOY.md).`)
  return id
}

/**
 * Barkpark's resolved tree for that desk. The default keeps the plain path; another desk asks
 * for it by `?desk=`, and only a tree that names it back (`desk`) is that desk: a Barkpark
 * without `?desk=` (task-31f9264adeb053be) answers the default desk's tree, which must never show as this one.
 */
export const structurePath = (dataset: string, id: string) => `/v1/structure/${dataset}${id === DEFAULT_DESK_ID ? '' : `?desk=${encodeURIComponent(id)}`}`
export const servesDesk = (id: string, body: {desk?: unknown}) => id === DEFAULT_DESK_ID || body.desk === id
