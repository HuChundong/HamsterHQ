/** Dated Cube aliases encode same-day release dots as hyphens; image/UI stamps retain dots. */
import assert from 'node:assert/strict'
import { shortVersionFromTemplate } from '../gateway/src/sandbox-version.js'

for (const kind of ['desktop', 'sandbox']) {
  for (const [suffix, expected] of [
    ['2026-09-11', '2026-09-11'],
    ['2026-09-11-2', '2026-09-11.2'],
    ['2026-09-11-12', '2026-09-11.12'],
    ['2026-09-11.2', '2026-09-11.2'],
    ['custom-2', 'custom-2'],
  ]) {
    assert.equal(shortVersionFromTemplate(`hamsterhq-${kind}-${suffix}`), expected)
  }
}
assert.equal(shortVersionFromTemplate('tpl-example-2'), 'tpl-example-2')
assert.equal(shortVersionFromTemplate(undefined), null)
assert.equal(shortVersionFromTemplate('  '), null)
console.log('check-sandbox-version: legal aliases preserve the image version stamp')
