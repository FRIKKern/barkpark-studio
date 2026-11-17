import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {Field} from './data.ts'
import {Window} from 'happy-dom'
import {deprecatedIds, deprecatedReason, describeControl, insertItemProps, noteParts, ptDeprecated} from './deprecated.ts'
import {memberChoices, membersOf} from './array-members.ts'
import {insertable} from './pt-value.ts'
import {fieldAria} from './field-aria.ts'

// Sanity's deprecated: {reason} (task-f47e461e674dc638): a deprecated field keeps its value
// and its input, with a "deprecated" badge by its title and the reason under it; a deprecated
// type stays in the Portable Text insert menu, disabled, its reason the tooltip (Sanity 6.17's
// toolbar InsertMenu: disabled={Boolean(item.type.deprecated)}, tooltipText deprecated.reason).
// Sanity's array insert menu offers a deprecated member like any other (insert-menu/InsertMenu.tsx).
test("a deprecated field and a deprecated member type carry Sanity's reason", () => {
  const old: Field = {name: 'old', type: 'string', deprecated: {reason: 'Use title'}}
  assert.equal(deprecatedReason(old), 'Use title')
  assert.equal(deprecatedReason({name: 'title', type: 'string'}), undefined)
  // The badge and the reason describe the field's control (after the problem, before the help); its name stays the title.
  assert.equal(fieldAria('old', {...old, description: 'Old title'}, true)['aria-describedby'], 'old-problem old-deprecated-label old-deprecated old-desc')

  // The array insert menu, from the members as Barkpark serves them: a deprecated member is offered and added like any other, as Sanity's.
  const blocks = {name: 'parts', type: 'arrayOf', of: [{name: 'hero', title: 'Hero', type: 'composite', fields: []}, {name: 'legacyCard', title: 'Legacy card', type: 'composite', deprecated: {reason: 'Use Hero'}, fields: []}] as unknown as Field}
  const choices = memberChoices(membersOf(blocks))
  assert.deepEqual(choices, [{value: 'hero', title: 'Hero'}, {value: 'legacyCard', title: 'Legacy card'}])

  // The Portable Text insert menu: a deprecated block and inline object type, by name.
  const pt = {name: 'body', type: 'richText', blocks: {of: ['image', {name: 'oldQuote', title: 'Old quote', deprecated: {reason: 'Use a blockquote'}}], inline: [{name: 'oldChip', deprecated: {reason: 'Use a link'}}]}} as Field
  const {blocks: ptBlocks, inline} = insertable(pt)
  assert.deepEqual(ptBlocks.map((b) => ptDeprecated(pt, 'block', b.name)), [undefined, 'Use a blockquote'])
  assert.deepEqual(inline.map((i) => ptDeprecated(pt, 'inline', i.name)), ['Use a link'])
  assert.deepEqual(insertItemProps(ptDeprecated(pt, 'block', 'oldQuote')), {'aria-disabled': true, 'data-tip': 'Use a blockquote', 'data-deprecated': ''})
  assert.deepEqual(insertItemProps(ptDeprecated(pt, 'block', 'image')), {})
})

// Sanity's label and legend hold the title alone; the badge and the reason sit beside them. Ours
// sit inside (the label wraps a boolean's input, the legend heads the fieldset), so they are kept
// out of the name and read as the description, drawn with DeprecatedNote's own props and wiring.
test("a deprecated boolean's and object's accessible name is the title alone; the badge and reason describe it", () => {
  const document = new Window().document as unknown as Document
  const note = (path: string, reason: string) => {
    const parts = noteParts(path)
    const span = (props: Record<string, unknown>, text: string) => `<span ${Object.entries(props).map(([k, v]) => `${k}="${v}"`).join(' ')}>${text}</span>`
    return span(parts.badge, 'deprecated') + span(parts.reason, reason)
  }
  document.body.innerHTML = `<label class="bool-box"><input id="agree" type="checkbox"><span>Agree</span>${note('agree', 'Use the form.')}</label>` + `<fieldset id="address"><legend><span>Address</span>${note('address', 'Use Place.')}</legend></fieldset>`
  for (const path of ['agree', 'address']) describeControl(document.getElementById(`${path}-deprecated-label`)!, deprecatedIds(path, 'x'))
  // The text a name is computed from: a subtree marked aria-hidden is left out (accname 1.2, 2A).
  const text = (n: Node): string => (n.nodeType === 3 ? n.textContent ?? '' : (n as Element).getAttribute?.('aria-hidden') === 'true' || (n as Element).tagName === 'INPUT' ? '' : [...n.childNodes].map(text).join(''))
  const described = (el: Element) => (el.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent).join(' ')
  const box = document.getElementById('agree')!
  assert.equal(text(box.closest('label')!).trim(), 'Agree')
  assert.equal(described(box), 'deprecated Use the form.')
  const group = document.getElementById('address')!
  assert.equal(text(group.querySelector('legend')!).trim(), 'Address')
  assert.equal(described(group), 'deprecated Use Place.')
})
