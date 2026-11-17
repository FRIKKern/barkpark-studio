import {test} from 'node:test'
import assert from 'node:assert/strict'
import {actions, modalOf, modalWidth, placePopover, rowParts} from './array-options.ts'

// Sanity's array options (sanity 6.17 PreviewItem, ItemRow, ReferenceItem, fieldResolver): disableActions
// takes exactly the named actions away, sortable: false takes the drag handles, modal picks dialog or popover.

test("Sanity's disableActions and sortable: false decide the item menu and handles", () => {
  const some = actions({disableActions: ['remove', 'duplicate']})
  assert.deepEqual(some, {add: true, addBefore: true, addAfter: true, remove: false, duplicate: false, copy: true, paste: true})
  // What SortableRows draws: the row's handle, its "…" menu entries in order, and Add item.
  assert.deepEqual(rowParts({disableActions: ['remove', 'duplicate'], sortable: false}, true), {handle: false, menu: ['copy', 'addBefore', 'addAfter'], add: true, copy: true})
  assert.deepEqual(rowParts(undefined, true), {handle: true, menu: ['remove', 'copy', 'duplicate', 'addBefore', 'addAfter'], add: true, copy: true})
  // 'add' takes Add item, both inserts and the field's Paste; 'copy' the item's Copy and Copy field.
  assert.deepEqual(rowParts({disableActions: ['add', 'copy']}, true), {handle: true, menu: ['remove', 'duplicate'], add: false, copy: false})
  assert.deepEqual(actions({disableActions: ['add', 'copy']}), {add: false, addBefore: false, addAfter: false, remove: true, duplicate: true, copy: false, paste: false})
  assert.deepEqual(rowParts({disableActions: ['addBefore']}, false).menu, ['remove', 'duplicate', 'addAfter'])
  // Every action gone: no menu at all (Sanity draws no "…").
  assert.deepEqual(rowParts({disableActions: ['add', 'remove', 'duplicate', 'copy']}, true).menu, [])
  // A select's list (options as an array) or junk: nothing is disabled.
  assert.deepEqual(actions([{value: 'a'}]), actions({}))
  assert.deepEqual(actions({disableActions: 'remove'}), actions({}))
  assert.equal(rowParts({sortable: true}, false).handle, true)

  assert.deepEqual(modalOf({modal: {type: 'popover', width: 2}}), {type: 'popover', width: 2})
  assert.deepEqual(modalOf({}), {type: 'dialog', width: 1})
  assert.deepEqual(modalOf({modal: {type: 'popover'}}), {type: 'popover', width: 1})
})

test("modal width: Sanity's container sizes, responsive by its breakpoints; the popover stays 4 px inside its pane", () => {
  assert.equal(modalWidth(1, 1440), 640)
  assert.equal(modalWidth(2, 1440), 960)
  assert.equal(modalWidth('auto', 1440), null)
  // [1, 2]: 640 on a phone, 960 from 360 px up; [1, 1, 3]: 1280 from 600 px.
  assert.equal(modalWidth([1, 2], 359), 640)
  assert.equal(modalWidth([1, 2], 360), 960)
  assert.equal(modalWidth([1, 1, 3], 700), 1280)
  assert.equal(modalWidth(9, 1440), 640)
  // At 390 px a 640 px popover is 382 wide, 4 px in, under its row.
  const row = {left: 41, top: 300, width: 300, height: 49}
  const host = {left: 0, top: 60, width: 390, height: 700}
  assert.deepEqual(placePopover(row, host, 640, 400), {left: 4, top: 293, width: 382, maxHeight: 403, side: 'bottom', hidden: false})
  // Little room below and more above: it flips over the row.
  assert.deepEqual(placePopover({...row, top: 600}, host, 640, 500), {left: 4, top: 36, width: 382, maxHeight: 532, side: 'top', hidden: false})
  // Its height never passes the pane's (minus 4 px each side).
  assert.ok(placePopover({...row, top: 2000}, host, 640, 900).maxHeight <= host.height - 8)
  assert.ok(placePopover({...row, top: 400}, {...host, height: 300}, 640, 900).maxHeight <= 292)
  assert.equal(placePopover(row, host, 640, 400).hidden, false)
})

test('a popover whose row has left the pane hides, as Sanity\'s (floating-ui hide: referenceHidden)', () => {
  const host = {left: 0, top: 188, width: 798, height: 663}
  const row = {left: 109, top: 0, width: 551, height: 49}
  // Scrolled below the pane (row at 1395, the pane ends at 851): hidden, not drawn over the footer.
  assert.equal(placePopover({...row, top: 1395}, host, 640, 600).hidden, true)
  // Scrolled above it (over the title bar): hidden.
  assert.equal(placePopover({...row, top: 100}, host, 640, 600).hidden, true)
  // A row with any part in the pane keeps its popover.
  assert.equal(placePopover({...row, top: 830}, host, 640, 600).hidden, false)
  assert.equal(placePopover({...row, top: 150}, host, 640, 600).hidden, false)
})

test('placement in a wide pane', () => {
  // Wide pane: centred on the row.
  assert.equal(placePopover({left: 400, top: 100, width: 600, height: 49}, {left: 0, top: 0, width: 1400, height: 900}, 640, 300).left, 380)
})
