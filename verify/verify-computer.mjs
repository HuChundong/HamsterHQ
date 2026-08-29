/**
 * `/computer/` is session-gated; on a desktop sandbox it serves noVNC.
 *
 * Anonymous callers must get 401. A signed-in caller whose machine has no
 * desktop may see 502/503 — that is not a gate failure. When the status is
 * 200, the body should look like noVNC.
 *
 * Run inside the gateway container (verify.sh copies it there).
 */

import process from 'node:process'
import { signIn } from './verify-login.mjs'

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const USER = process.env.VERIFY_ALICE ?? 'delivered+alice@resend.dev'

let passed = 0
let failed = 0

/**
 * @param {string} label
 * @param {boolean} ok
 * @param {string} detail
 */
function check(label, ok, detail) {
  const mark = ok ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m'
  console.log(`  ${mark}  ${label.padEnd(46)} ${detail}`)
  if (ok) passed += 1
  else failed += 1
}

console.log('\n=== computer plane ===')

const anon = await fetch(`${GATEWAY}/computer/vnc.html`)
check('anonymous GET /computer/vnc.html is refused', anon.status === 401, `HTTP ${anon.status}`)

const cookie = await signIn(GATEWAY, USER)
const authed = await fetch(`${GATEWAY}/computer/vnc.html`, {
  headers: { Cookie: cookie },
  redirect: 'manual',
})
const okAuthed = authed.status === 200 || authed.status === 502 || authed.status === 503
check('authenticated GET reaches the tunnel', okAuthed, `HTTP ${authed.status}`)

if (authed.status === 200) {
  const body = await authed.text()
  check('response looks like noVNC', /noVNC|novnc|websockify|RFB/i.test(body), body.slice(0, 80))
}

console.log(`computer: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
