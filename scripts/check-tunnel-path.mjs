/**
 * Path → authority helpers for the sandbox tunnel.
 *
 * `/computer` must dial noVNC on :6080 with the `/computer` prefix stripped;
 * everything else stays on dsh. Wrong authority is a silent 502 in production.
 *
 * Run: node scripts/check-tunnel-path.mjs
 */

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { authorityFor, localPathFor } = await import(
  join(root, 'packages/tunnel-protocol/protocol.js')
)

const dsh = '127.0.0.1:3080'

assert.equal(authorityFor('/api/foo', dsh), dsh)
assert.equal(authorityFor('/files/upload', dsh), dsh)
assert.equal(authorityFor('/browser/status', dsh), dsh)
assert.equal(authorityFor('/computer', dsh), '127.0.0.1:6080')
assert.equal(authorityFor('/computer/', dsh), '127.0.0.1:6080')
assert.equal(authorityFor('/computer/vnc.html', dsh), '127.0.0.1:6080')
assert.equal(authorityFor('/computer/websockify', dsh), '127.0.0.1:6080')
assert.equal(authorityFor('/computer/vnc.html?autoconnect=true', dsh), '127.0.0.1:6080')
assert.equal(authorityFor('/computerized', dsh), dsh)

assert.equal(localPathFor('/api/events.mux'), '/api/events.mux')
assert.equal(localPathFor('/computer'), '/')
assert.equal(localPathFor('/computer/'), '/')
assert.equal(localPathFor('/computer/vnc.html'), '/vnc.html')
assert.equal(localPathFor('/computer/vnc.html?autoconnect=true'), '/vnc.html?autoconnect=true')
assert.equal(localPathFor('/computer/websockify'), '/websockify')

console.log('ok')
