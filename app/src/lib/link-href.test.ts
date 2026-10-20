import assert from 'node:assert/strict'
import {test} from 'node:test'
import {linkHref, storedHref} from './link-href.ts'

// J10: a script or data address never reaches the canvas from the toolbar's link input.
test('J10: the link input takes only the reader allowlist', () => {
  for (const bad of ['javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', '//evil.example/x', 'vbscript:x', ''])
    assert.equal(linkHref(bad), null, JSON.stringify(bad))
  for (const good of ['https://example.com', 'http://a.b', 'mailto:a@b.co', 'tel:+47123', '/papers/x', '#top', './x'])
    assert.equal(linkHref(good), good, good)
  assert.equal(linkHref('  https://example.com  '), 'https://example.com')
})

// A stored address the allowlist refuses is drawn as words in the read view and Review changes.
test('stored links: refused addresses lose their href, allowed ones keep it', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', '//evil.example', undefined, null, ''])
    assert.equal(storedHref(bad), undefined, JSON.stringify(bad))
  for (const good of ['https://example.com', 'mailto:a@b.co', 'tel:+47123', '/papers/x', '#top']) assert.equal(storedHref(good), good, good)
})
