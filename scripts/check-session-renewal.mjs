/**
 * A rotation that is spent has to be delivered.
 *
 * A refresh token is retired the moment it is used — that is what makes
 * signing out take effect — and the replacement is returned to whoever spent
 * it. So a request that spends one and cannot hand the replacement back leaves
 * the browser holding a cookie the store no longer honours. Nothing fails at
 * the time: the request it happened on is answered normally, and the person
 * meets it days later as a sign-in prompt with no explanation.
 *
 * That is the bug this check exists for. The WebSocket-upgrade path has no
 * response object, so it cannot deliver a cookie, and it used to authenticate
 * through the same helper as every other route anyway — retiring the browser's
 * only refresh token every time a tab's event stream reconnected after the
 * fifteen-minute access token had lapsed.
 *
 * What is asserted is the property, not the shape: every place that
 * authenticates without a response must be one that says so. `callerOf` reads
 * its own second argument to decide whether a rotation may happen, so a new
 * res-less caller that forgets the distinction is a new instance of the bug.
 *
 * Run: node scripts/check-session-renewal.mjs
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const server = readFileSync(join(root, 'gateway/src/server.js'), 'utf8')
const auth = readFileSync(join(root, 'gateway/src/auth.js'), 'utf8')

const problems = []
const check = (ok, message) => { if (!ok) problems.push(message) }

// The mechanism has to exist at all.
check(
  /export async function authenticate\(req, tokens, accounts, canRenew = true\)/.test(auth),
  'authenticate must take the whether-this-caller-can-renew flag',
)
check(
  auth.includes('if (!canRenew) return undefined'),
  'authenticate must refuse before spending when the caller cannot deliver the replacement',
)
// Refusing before the spend is the whole point: a spend that happens first is
// the defect, however the result is used.
const spendAt = auth.indexOf('await tokens.spendRefresh(')
const guardAt = auth.indexOf('if (!canRenew) return undefined')
check(
  guardAt !== -1 && spendAt !== -1 && guardAt < spendAt,
  'the cannot-renew guard must come before the refresh token is spent',
)

// And every call site has to pass something honest.
check(
  /const deliverable = res !== undefined && !res\.headersSent/.test(server),
  'callerOf must derive deliverability from the response it was given',
)
check(
  /authenticate\(req, tokens, accounts, deliverable\)/.test(server),
  'callerOf must pass that deliverability into authenticate',
)

// A response that has already started cannot carry a renewed cookie either, so
// the delivery has to be guarded by the same fact that gated the rotation.
check(
  /if \(resolved\.cookies !== undefined && deliverable\)/.test(server),
  'the renewed cookies must be set only when the rotation was allowed',
)

// Every caller, classified. A call with no response in scope is the shape that
// must be deliberate; one with a response must use it.
const calls = server.split('\n')
  // Comments name the helper to explain it — `callerOf(req)` in a comment is
  // not a call site, and counting it would make the expected number wrong.
  .filter((line) => !/^\s*(\/\/|\*)/.test(line))
  .flatMap((line) => [...line.matchAll(/callerOf\(([^)]*)\)/g)].map((m) => m[1].trim()))
  .filter((args) => !args.startsWith('req, res, renewedAsHeaders'))
const resLess = calls.filter((args) => !args.startsWith('req, res'))
const withRes = calls.filter((args) => args.startsWith('req, res'))

// The two that cannot renew are the two WebSocket handshakes: the panel's
// terminal and dsh's own downlinks. A third would mean a new one arrived
// without deciding which it is — which is the moment to read this file again.
check(
  resLess.length === 2,
  `expected 2 response-less call sites, the two handshakes; found ${resLess.length}: ${resLess.join(' | ')}`,
)
check(
  withRes.length >= 6,
  `expected the response-carrying routes to still pass one; found ${withRes.length}`,
)

// And the behaviour, by running the real authenticator against a store that
// records what happened. Source text can show a guard exists; only this shows
// it is on the path a handshake takes.
{
  const { authenticate } = await import('../gateway/src/auth.js')
  const spend = []
  const tokens = {
    readAccess: async () => undefined,                        // the access token has expired
    spendRefresh: async () => { spend.push('spent'); return { email: 'a@b.c', refresh: 'next' } },
    issueAccess: async () => 'fresh',
  }
  const accounts = { read: async () => ({ id: '1', email: 'a@b.c', admin: false, disabled: false }) }
  const req = { headers: { cookie: 'dsh_gw_refresh=current' } }

  const handshake = await authenticate(req, tokens, accounts, false)
  check(handshake === undefined, 'a handshake with an expired access token must be refused')
  check(spend.length === 0, 'a handshake must not spend the refresh token it cannot replace')

  const page = await authenticate(req, tokens, accounts, true)
  check(page !== undefined, 'a request that can deliver the replacement must still renew')
  check(spend.length === 1, 'and must spend exactly one refresh token to do it')
  check(
    Array.isArray(page?.cookies) && page.cookies.length === 2,
    'the renewal must produce both cookies for the caller to set',
  )
}

if (problems.length > 0) {
  console.error('check-session-renewal: a rotation can be spent without being delivered\n')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`check-session-renewal: ${withRes.length} route(s) may renew and ${resLess.length} handshake(s) refuse instead`)
