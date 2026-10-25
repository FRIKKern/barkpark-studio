import assert from 'node:assert/strict'
import {test} from 'node:test'
import {parseErrorsOf, reportParseError} from './parse-errors.ts'

// task-dd31e51507a6fd56: what useParseErrors hands the document pane.
test('a field reports unreadable text, a report replaces its last, null clears it', () => {
  reportParseError('doc-1', 'day', 'Invalid date. Must be on the format "DD.MM.YYYY"')
  const first = parseErrorsOf('doc-1')
  reportParseError('doc-1', 'day', 'Invalid date. Must be on the format "DD.MM.YYYY"')
  assert.equal(parseErrorsOf('doc-1'), first) // nothing changed: the same snapshot (no re-render)
  reportParseError('doc-1', 'at', 'Invalid date. Must be on the format "DD.MM.YYYY HH:mm"')
  assert.deepEqual(parseErrorsOf('doc-1').map(([p]) => p), ['day', 'at'])
  assert.deepEqual(parseErrorsOf('doc-2'), [])
  reportParseError('doc-1', 'day', null)
  reportParseError('doc-1', 'at', null)
  assert.deepEqual(parseErrorsOf('doc-1'), [])
})
