import {createElement, Fragment} from 'react'
import {defineBehavior, raise} from '@portabletext/editor/behaviors'
import {BehaviorPlugin} from '@portabletext/editor/plugins'
import {OneLinePlugin} from '@portabletext/plugin-one-line'
import type {Field} from './data'
import {isOneLine} from './pt-value.ts'

const LINE_BREAKS = /(?:\r\n|\r|\n)+/g

const behaviors = [
  // Shift+Enter breaks no line either, as Sanity's (core/form/inputs/PortableText/object/Plugins.tsx).
  defineBehavior({on: 'insert.soft break', actions: []}),
  // Text put in with a line break in it (dictation, a text service, an autocorrect replacement: the
  // browser's insertText or insertReplacementText) would hold the break inside the span. Each run of
  // breaks becomes one space, in the same span.
  defineBehavior({
    on: 'insert.text',
    guard: ({event}) => /[\r\n]/.test(event.text),
    actions: [({event}) => [raise({type: 'insert.text', text: event.text.replace(LINE_BREAKS, ' ')})]],
  }),
]

/**
 * A Portable Text field with `options.oneLine`, as Sanity's: its OneLinePlugin, the version
 * Sanity 6.17 ships. Enter never splits the block (over a selection it deletes it), a paste of
 * several lines or blocks joins into the caret's block, and a block inserted before or after
 * it is dropped. A stored value holding several blocks is not rewritten: it opens as it is.
 * Mounted before the editor's other plugins: behaviors run in the order they register, and
 * the first claims an `insert.*` event. Plain createElement, so the unit tests run it in Node.
 */
export function OneLine({field}: {field: Pick<Field, 'options'>}) {
  return isOneLine(field) ? createElement(Fragment, null, createElement(OneLinePlugin), createElement(BehaviorPlugin, {behaviors})) : null
}

/** The editable's own props, one line (isOneLine) or not: a screen reader hears a one-line text box. */
export const oneLineEditable = (oneLine: boolean): {'aria-multiline'?: false} => (oneLine ? {'aria-multiline': false} : {})
