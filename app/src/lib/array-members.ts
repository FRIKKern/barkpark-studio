// An array's member types (task-3da190705a269df1). Barkpark serves an arrayOf's `of` as one
// member, or as a list of them when the array takes several types: a page builder, whose
// sections are named object types that Barkpark expands and marks with `namedType`. Sanity
// draws each item with its own member's preview and icon, and "Add item" offers the members.
import type {Field, Schema} from './data'

type Item = {_type?: unknown; _key?: string} & Record<string, unknown>

/** The array's members: the list as served, or the one member. */
export function membersOf(field: Pick<Field, 'of'>): Field[] {
  const of = field.of as Field | Field[] | undefined
  return Array.isArray(of) ? of.filter((m): m is Field => !!m && typeof m === 'object') : of ? [of] : []
}

/** The `_type` an item of this member carries: its name, as Sanity writes it. */
export const memberName = (m: Field): string => m.name || m.namedType || m.type

/** Several members of objects (or images): a page builder, drawn as rows of items. */
export const isObjectMembers = (members: Field[]) => members.length > 1 && members.every((m) => m.type === 'composite' || m.type === 'image')

/** An item's member: by its `_type`; an only member takes every item. */
export function memberFor(members: Field[], item: unknown): Field | undefined {
  if (members.length === 1) return members[0]
  const type = item && typeof item === 'object' ? (item as Item)._type : undefined
  if (typeof type !== 'string') return undefined
  return members.find((m) => memberName(m) === type) ?? members.find((m) => m.namedType === type)
}

/** The add menu: one entry per member, titled as the member (or its named type) is. */
export function memberChoices(members: Field[], schemas: Pick<Schema, 'name' | 'title'>[] = []): {value: string; title: string}[] {
  return members.map((m) => {
    const named = m.namedType ? schemas.find((s) => s.name === m.namedType) : undefined
    return {value: memberName(m), title: m.title || named?.title || memberName(m)}
  })
}

/** A new item of a member, as Sanity adds one: its `_type`, a fresh `_key` and the member's starting values. */
export function newMemberItem(member: Field, key: string): Item {
  if (member.type === 'image') return {_type: memberName(member), _key: key}
  return {...member.initialValue, _type: memberName(member), _key: key}
}

/**
 * The preview a member's item reads: the member's own, else its named type's list preview
 * (a section schema's), else none (the item's first string field titles it).
 */
export function memberPreview(member: Field, schemas: Pick<Schema, 'name' | 'listPreview'>[] = []): Field['preview'] {
  if (member.preview && Object.keys(member.preview).length) return member.preview
  const named = member.namedType ? schemas.find((s) => s.name === member.namedType)?.listPreview : undefined
  return named && Object.keys(named).length ? (named as Field['preview']) : undefined
}
