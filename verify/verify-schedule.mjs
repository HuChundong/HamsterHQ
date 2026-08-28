/**
 * A scheduled task runs when nobody is there.
 *
 * The claim this feature exists to make is not "a timer fires". It is that a
 * tenant with no browser open and **no sandbox at all** gets their work done
 * anyway — the scheduler notices, the gateway builds a machine, the plugin
 * inside it fetches its own list and runs the turn. Every part of that is
 * exercised only if the sandbox is destroyed first, which is why this suite
 * destroys it and waits rather than scheduling something in a machine that is
 * already up.
 *
 * That distinction matters more than it looks. A deployment whose tenants have
 * frequent tasks almost never takes the cold path — the machine stays up, the
 * plugin's own timer fires, and everything works. The cold path is the one that
 * rots, so it is the one that gets proved.
 *
 * Run inside the gateway container, like the other node suites here: it is the
 * one place with the deployment's own network and its dependencies.
 */

import process from 'node:process'
import { signIn } from './verify-login.mjs'

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const USER = process.env.SCHEDULE_USER ?? process.env.VERIFY_ALICE ?? 'delivered+alice@resend.dev'

/**
 * How long to wait for a cold machine to come back and finish a turn.
 *
 * Generous, and deliberately so: it covers the scheduler's tick, the sandbox
 * creation, the dial-in, the plugin's first fetch, and a real model turn. A
 * tight bound here would fail on a slow morning and teach whoever ran it to
 * ignore this suite.
 */
const PATIENCE_MS = 10 * 60 * 1000

/** How often to ask whether the run has been recorded. */
const POLL_MS = 5000

/** The interval the task is created at, in seconds. Short, to keep the suite short. */
const EVERY_SECONDS = Number(process.env.SCHEDULE_EVERY_SECONDS ?? 300)

let cookie

/**
 * One call to the tenant's schedule plane.
 * @param {string} method - the HTTP method.
 * @param {string} path - the path under /schedule.
 * @param {object} [body] - the payload.
 * @returns {Promise<{status: number, value: object}>} the answer.
 */
async function schedule(method, path, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', Cookie: cookie } }
  if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(body ?? {})
  const response = await fetch(`${GATEWAY}/schedule${path}`, init)
  return { status: response.status, value: await response.json().catch(() => ({})) }
}

/**
 * Stop, reporting why.
 * @param {string} why - what failed.
 */
function fail(why) {
  console.error(`FAIL: ${why}`)
  process.exit(1)
}

cookie = await signIn(GATEWAY, USER)
console.log(`signed in as ${USER}`)

// A deployment without a scheduler is not a failure of this suite — it is a
// composition that does not offer the feature, and it says so with 501.
const probe = await schedule('GET', '/tasks')
if (probe.status === 501) {
  console.log('SKIP: this deployment runs no scheduler')
  process.exit(0)
}
if (probe.value?.ok !== true) fail(`the schedule plane answered ${probe.status}: ${JSON.stringify(probe.value)}`)

// Left behind by an interrupted run, and they would spend model tokens on every
// tick from now on. Cleared before rather than after, so a suite that dies
// half way still leaves the next run a clean deployment.
for (const stale of probe.value.tasks ?? []) {
  await schedule('DELETE', `/tasks/${stale.id}`)
}

const created = await schedule('POST', '/tasks', {
  task: {
    title: 'acceptance',
    prompt: 'Reply with exactly the word READY and nothing else.',
    kind: 'every',
    rule: { seconds: EVERY_SECONDS },
  },
})
if (created.value?.ok !== true) {
  fail(`the task was refused: ${created.value?.code} ${created.value?.message ?? ''}`)
}
const task = created.value.task
console.log(`task ${task.id} created, first occurrence ${task.nextRunAt}`)

// The whole point of the suite. Everything above would pass with the tenant's
// sandbox running and the plugin's timer doing the work; from here the machine
// has to be built by the deployment itself, with nobody watching.
const dropped = await fetch(`${GATEWAY}/sandbox/restart`, {
  method: 'POST',
  headers: { Cookie: cookie },
})
console.log(`sandbox thrown away (${dropped.status}); nothing is attached from here on`)

const deadline = Date.now() + PATIENCE_MS
let outcome
while (Date.now() < deadline) {
  await new Promise((resolve) => { setTimeout(resolve, POLL_MS) })
  const runs = await schedule('GET', `/tasks/${task.id}/runs`)
  const finished = (runs.value?.runs ?? []).find((run) => run.finishedAt !== null)
  if (finished !== undefined) {
    outcome = finished
    break
  }
  const claimed = (runs.value?.runs ?? []).length
  process.stdout.write(`\r  waiting — ${Math.round((deadline - Date.now()) / 1000)}s left, ${claimed} occurrence(s) claimed   `)
}
process.stdout.write('\n')

await schedule('DELETE', `/tasks/${task.id}`)

if (outcome === undefined) {
  fail('no run was claimed and finished before the deadline — the machine never came back, or the plugin never fetched its list')
}
if (outcome.status !== 'ok') {
  fail(`the run was recorded as ${outcome.status}: ${outcome.detail ?? 'no detail'}`)
}
if (typeof outcome.sessionId !== 'string' || outcome.sessionId === '') {
  fail('the run reported no session — it was recorded without a turn behind it')
}

console.log(`PASS: a destroyed sandbox was rebuilt on schedule and ran the turn in session ${outcome.sessionId}`)
process.exit(0)
