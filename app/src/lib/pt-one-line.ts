import {createElement, Fragment} from 'react'
import {defineBehavior} from '@portabletext/editor/behaviors'
import {BehaviorPlugin} from '@portabletext/editor/plugins'
import {OneLinePlugin} from '@portabletext/plugin-one-line'
import type {Field} from './data'
import {isOneLine} from './pt-value.ts'

// Shift+Enter breaks no line either, as Sanity's (core/form/inputs/PortableText/object/Plugins.tsx).
const noSoftBreak = [defineBehavior({on: 'insert.soft break', actions: []})]

/**
 * A Portable Text field with `options.oneLine`, as Sanity's: its OneLinePlugin, the version
 * Sanity 6.17 ships. Enter never splits the block (over a selection it deletes it), a paste of
 * several lines or blocks joins into the caret's block, and a block inserted before or after
 * it is dropped. A stored value holding several blocks is not rewritten: it opens as it is.
 * Mounted before the editor's other plugins: behaviors run in the order they register, and
 * the first claims an `insert.*` event. Plain createElement, so the unit tests run it in Node.
 */
export function OneLine({field}: {field: Pick<Field, 'options'>}) {
  return isOneLine(field) ? createElement(Fragment, null, createElement(OneLinePlugin), createElement(BehaviorPlugin, {behaviors: noSoftBreak})) : null
}
