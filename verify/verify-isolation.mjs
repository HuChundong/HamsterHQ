/**
 * Tenant isolation.
 *
 * The property that matters most: one tenant's sessions, workspace, and agent
 * must be unreachable from another tenant's browser. Isolation here is not a
 * filter the gateway applies to a shared backend — each tenant's requests land
 * in a different dsh process, and this proves that separation holds at the API
 * a browser can actually reach.
 */

import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { signIn } from './verify-login.mjs'
import { harnessRpc } from './harness-rpc.mjs'

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'

let passed = 0
let failed = 0

/**
 * Record one acceptance result.
 * @param {string} label - what was checked.
 * @param {boolean} ok - whether it held.
 * @param {string} detail - observed value.
 */
function check(label, ok, detail) {
  const mark = ok ? '[32mPASS[0m' : '[31mFAIL[0m'
  console.log(`  ${mark}  ${label.padEnd(46)} ${detail}`)
  if (ok) passed += 1
  else failed += 1
}

const alice = await signIn(GATEWAY, process.env.VERIFY_ALICE ?? 'delivered+alice@resend.dev')
const bob = await signIn(GATEWAY, process.env.VERIFY_BOB ?? 'delivered+bob@resend.dev')
const aliceRpc = await harnessRpc(GATEWAY, alice)
const bobRpc = await harnessRpc(GATEWAY, bob)

const created = await aliceRpc.call('session/create', { request: { cwd: '/mnt/workspace' } })
if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`)
const aliceSession = created.value.sessionId
console.log(`\nalice created ${aliceSession}`)

console.log('\n=== 9. One tenant cannot see another tenant\'s sessions ===')

const aliceList = await aliceRpc.call('session/list', { _request: {} })
const aliceIds = JSON.stringify(aliceList.value ?? {})
check('alice sees her own session', aliceList.ok === true && aliceIds.includes(aliceSession), aliceList.ok === true ? 'listed' : 'list failed')

const bobList = await bobRpc.call('session/list', { _request: {} })
const bobIds = JSON.stringify(bobList.value ?? {})
check('bob does not see it in his list', bobList.ok === true && !bobIds.includes(aliceSession), bobList.ok === true ? 'absent' : 'list failed')

console.log('\n=== 10. One tenant cannot read another tenant\'s session ===')

const page = { request: { address: { kind: 'session', sessionId: aliceSession }, throughSeq: -1 } }
const own = await aliceRpc.call('session/page', page)
check('alice can read her history', own.ok === true, own.ok ? 'readable' : own.error?.code)
const stolen = await bobRpc.call('session/page', page)
check('bob cannot read her history', stolen.error?.code === 'session/not-found', stolen.ok === true ? 'READ IT' : `refused: ${stolen.error?.code}`)

const hijacked = await bobRpc.call('session/prompt', { request: {
  requestId: randomUUID(),
  sessionId: aliceSession,
  mode: 'queue',
  content: [{ type: 'text', text: 'this must not run' }],
} })
check('bob cannot prompt into her session', hijacked.error?.code === 'session/not-found', hijacked.ok === true ? 'PROMPTED' : `refused: ${hijacked.error?.code}`)

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`)
process.exit(failed === 0 ? 0 : 1)
