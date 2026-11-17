import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {Field} from './data.ts'
import {deprecatedId, deprecatedReason, firstPickable, insertItemProps, ptDeprecated} from './deprecated.ts'
import {memberChoices, membersOf} from './array-members.ts'
import {insertable} from './pt-value.ts'
import {fieldAria} from './field-aria.ts'

// Sanity's deprecated: {reason} (task-f47e461e674dc638): a deprecated field keeps its value
// and its input, with a "deprecated" badge by its title and the reason under it; a deprecated
// type stays in an insert menu, disabled, its reason the tooltip (Sanity 6.17's Portable Text
// InsertMenu: disabled={Boolean(item.type.deprecated)}, tooltipText deprecated.reason).
test("a deprecated field and a deprecated member type carry Sanity's reason", () => {
  const old: Field = {name: 'old', type: 'string', deprecated: {reason: 'Use title'}}
  assert.equal(deprecatedReason(old), 'Use title')
  assert.equal(deprecatedReason({name: 'title', type: 'string'}), undefined)
  // The reason describes the field's control (after the problem and the help), its name stays the title.
  assert.equal(fieldAria('old', {...old, description: 'Old title'}, true)['aria-describedby'], `old-problem ${deprecatedId('old')} old-desc`)

  // The array insert menu, from the members as Barkpark serves them.
  const blocks = {name: 'parts', type: 'arrayOf', of: [{name: 'hero', title: 'Hero', type: 'composite', fields: []}, {name: 'legacyCard', title: 'Legacy card', type: 'composite', deprecated: {reason: 'Use Hero'}, fields: []}] as unknown as Field}
  const choices = memberChoices(membersOf(blocks))
  assert.deepEqual(choices, [{value: 'hero', title: 'Hero'}, {value: 'legacyCard', title: 'Legacy card', deprecated: 'Use Hero'}])
  assert.deepEqual(choices.map((c) => insertItemProps(c.deprecated)), [{}, {'aria-disabled': true, 'data-tip': 'Use Hero', 'data-deprecated': ''}])
  // Enter in the menu's search adds the first type it may add.
  assert.equal(firstPickable([choices[1]!, choices[0]!])?.value, 'hero')

  // The Portable Text insert menu: a deprecated block and inline object type, by name.
  const pt = {name: 'body', type: 'richText', blocks: {of: ['image', {name: 'oldQuote', title: 'Old quote', deprecated: {reason: 'Use a blockquote'}}], inline: [{name: 'oldChip', deprecated: {reason: 'Use a link'}}]}} as Field
  const {blocks: ptBlocks, inline} = insertable(pt)
  assert.deepEqual(ptBlocks.map((b) => ptDeprecated(pt, 'block', b.name)), [undefined, 'Use a blockquote'])
  assert.deepEqual(inline.map((i) => ptDeprecated(pt, 'inline', i.name)), ['Use a link'])
})
