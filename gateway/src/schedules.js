/**
 * The gateway's whole share of scheduled tasks: an identity, and a relay.
 *
 * Two callers want the scheduler, and neither can be allowed to name a tenant
 * for itself:
 *
 * - **A tenant's browser**, through the shell, editing their own list. It is
 *   authenticated the way every other tenant surface here is, by the session
 *   cookie, and the address on that session is the tenant.
 * - **A tenant's sandbox**, through the plugin's host half, fetching its tasks
 *   and claiming occurrences. It presents the pair it dials the tunnel with,
 *   and the `sandboxes` table says whose machine that is.
 *
 * In both cases the username is decided HERE and put on the request, and the
 * caller's own opinion of who it is never reaches the scheduler. A sandbox
 * cannot ask for somebody else's tasks, because it does not get to say a name.
 *
 * ## What this file deliberately does not know
 *
 * What a cron expression means, when anything is due, whether a run happened,
 * or what a task's prompt says. It reads the body far enough to add
 * entitlements and forwards the rest opaquely. That is not fastidiousness: the
 * gateway authenticates every tenant and holds the Docker socket, and the part
 * of this feature that will keep changing — zones, daylight saving, catch-up
 * policy — is deliberately in a different process. `check-scheduler-boundary.mjs`
 * fails the build if a cron dependency or a scheduler table name appears
 * anywhere under `gateway/src`.
 *
 * @module schedules
 */

import process from 'node:process'

/** How long to wait on the scheduler before giving up on one call. */
const TIMEOUT_MS = 15_000

/** Largest body relayed, matching the scheduler's own cap. */
export const BODY_LIMIT = 16 * 1024

/**
 * Where the scheduler is, or nothing.
 *
 * `firstOf`-shaped rather than `??`: compose hands every optional variable
 * over as an empty string, so `??` would find it present and never fall back.
 *
 * @returns {string} the base URL, or the empty string when this deployment has no scheduler.
 */
function base() {
  const configured = process.env.SCHEDULER_INTERNAL_URL
  return configured !== undefined && configured !== '' ? configured : ''
}

/**
 * Whether this deployment runs a scheduler at all.
 *
 * A deployment without one answers 501 rather than 500 or a hang, and the
 * plugin reads that as "this deployment does not do scheduled tasks" and hides
 * its own controls. Somebody running the two-service composition should see no
 * half-working button.
 *
 * @returns {boolean} whether scheduled tasks are available.
 */
export function schedulerConfigured() {
  return base() !== '' && (process.env.INTERNAL_SHARED_SECRET ?? '') !== ''
}

/**
 * The three entitlements the scheduler is allowed to see.
 *
 * Written out rather than forwarding the record, and the difference matters
 * twice. The record also carries `machine` and `idleTtlMs`, which are the
 * runtime's business and no part of deciding whether a schedule is legal —
 * sending them would put a tenant's machine size into a service that has no
 * reason to hold it. And `check-entitlements.mjs` reads this file for proof
 * that a declared field is obeyed somewhere; a spread would satisfy nothing,
 * because a field nobody names is a field nobody notices when it stops being
 * carried.
 *
 * @param {object} entitlements - the resolved record.
 * @returns {{maxScheduledTasks: number|undefined, minScheduleIntervalSeconds: number|undefined, maxScheduledRunsPerDay: number|undefined}} what the scheduler enforces.
 */
function limitsFrom(entitlements) {
  return {
    maxScheduledTasks: entitlements.maxScheduledTasks,
    minScheduleIntervalSeconds: entitlements.minScheduleIntervalSeconds,
    maxScheduledRunsPerDay: entitlements.maxScheduledRunsPerDay,
  }
}

/**
 * Relay one call to the scheduler on a named tenant's behalf.
 *
 * The username and the entitlement record are put on by this function and
 * cannot be supplied by the caller: `payload.username` and `payload.limits`
 * are overwritten, not defaulted. A caller that sent its own is ignored
 * silently rather than rejected, because the only way to send one is to be
 * writing a new client and the failure should be "it did nothing" rather than
 * "it worked in development".
 *
 * @param {object} options - the relay.
 * @param {string} options.method - the HTTP method.
 * @param {string} options.path - the scheduler path, with any query.
 * @param {string} options.username - whose tasks these are.
 * @param {object} options.entitlements - what that tenant is allowed.
 * @param {object} [options.payload] - the body, for methods that take one.
 * @returns {Promise<{status: number, value: object}>} the scheduler's answer.
 */
export async function relay({ method, path, username, entitlements, payload }) {
  if (!schedulerConfigured()) {
    return { status: 501, value: { ok: false, code: 'no_scheduler', message: 'this deployment runs no scheduler' } }
  }
  const url = new URL(path, base())
  url.searchParams.set('username', username)

  const init = {
    method,
    headers: { 'x-internal-secret': process.env.INTERNAL_SHARED_SECRET ?? '' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }
  if (method !== 'GET' && method !== 'DELETE') {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({ ...payload, username, limits: limitsFrom(entitlements) })
  }

  try {
    const response = await fetch(url, init)
    const text = await response.text()
    let value
    try {
      value = JSON.parse(text)
    } catch {
      value = { ok: false, code: 'internal', message: 'the scheduler did not answer with JSON' }
    }
    return { status: response.status, value }
  } catch (error) {
    // A scheduler that is down must not take the shell down with it. The
    // tenant's conversation, their files and their sandbox are all reachable
    // without it, and the honest report is that this one plane is unavailable.
    console.error(`gateway: the scheduler did not answer ${method} ${path}: ${error.message}`)
    return { status: 503, value: { ok: false, code: 'scheduler_unreachable', message: 'the scheduler is not answering' } }
  }
}

/**
 * The scheduler path one request maps to, or nothing.
 *
 * A closed table rather than a prefix rewrite, and that is the point: an open
 * relay in front of an internal service would let a tenant reach whatever that
 * service grows next, including routes written on the assumption that only the
 * gateway calls them. Adding a capability here is a deliberate line.
 *
 * @param {string} method - the request method.
 * @param {string} tail - the path after the surface's own prefix.
 * @returns {{method: string, path: string} | undefined} what to call, or nothing when the route is not exposed.
 */
export function route(method, tail) {
  if (tail === '/tasks' && (method === 'GET' || method === 'POST')) return { method, path: '/tasks' }

  const task = /^\/tasks\/([0-9a-f-]{36})$/.exec(tail)
  if (task !== null && (method === 'PATCH' || method === 'DELETE')) return { method, path: `/tasks/${task[1]}` }

  const runs = /^\/tasks\/([0-9a-f-]{36})\/runs$/.exec(tail)
  if (runs !== null && method === 'GET') return { method, path: `/tasks/${runs[1]}/runs` }

  const claim = /^\/tasks\/([0-9a-f-]{36})\/claim$/.exec(tail)
  if (claim !== null && method === 'POST') return { method, path: `/tasks/${claim[1]}/claim` }

  const finish = /^\/runs\/(\d{1,19})\/finish$/.exec(tail)
  if (finish !== null && method === 'POST') return { method, path: `/runs/${finish[1]}/finish` }

  return undefined
}

/**
 * The routes a browser may reach.
 *
 * Claiming and finishing are not among them. A tenant clicking in their own
 * shell has no business claiming an occurrence — that is the plugin's act,
 * taken because a timer fired — and exposing it would let a browser spend a
 * run without one ever coming due.
 *
 * @param {string} path - the scheduler path chosen by `route`.
 * @returns {boolean} whether a browser may ask for it.
 */
export function tenantMay(path) {
  return !path.endsWith('/claim') && !path.endsWith('/finish')
}

