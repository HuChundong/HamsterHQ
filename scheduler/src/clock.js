/**
 * The one clock, and the only thing in this deployment that watches it.
 *
 * The sweep does two things and neither of them is "run a task". It asks the
 * gateway to wake the machines that have work coming, and it writes down the
 * occurrences that nobody came back about. **The scheduler never fires
 * anything.** Firing belongs to the plugin inside the sandbox, which holds its
 * own timers for as long as it is alive, and the reason is worth keeping in
 * front of whoever changes this file:
 *
 * With one firer per tenant there is no such thing as a double run. Not
 * "unlikely", not "deduplicated" — there is no second party that could start
 * one. A design where the server also fires needs the server to know whether
 * the sandbox already did, which is a distributed agreement problem sitting
 * directly on top of somebody's model spend.
 *
 * So waking is an optimisation and never a correctness input. If a sandbox is
 * already up, the wake is a no-op and the plugin's own timer fires the
 * occurrence. If the plugin is broken, or the machine will not start, the
 * occurrence is missed — and `sweepLost` below is what makes that visible
 * rather than silent, which is the whole reason liveness is not consulted
 * anywhere in this file.
 *
 * @module clock
 */

import process from 'node:process'
import { nextOccurrence } from './rules.js'

/** How often the sweep runs. */
const TICK_MS = Number(process.env.SCHEDULER_TICK_MS ?? 15_000)

/**
 * How far ahead of an occurrence to ask for a machine.
 *
 * Waking is seconds, not minutes: the gateway calls `ensure()`, and a sandbox
 * that has to be created dials in well inside its own timeout. This is
 * therefore small on purpose. It used to be argued the other way — wake early,
 * be ready — but a machine started minutes ahead with no browser attached and
 * no agent working is reclaimed by the gateway's idle sweep before its own
 * task arrives, so early waking does not buy readiness, it buys a race.
 */
const WAKE_LEAD_MS = Number(process.env.SCHEDULER_WAKE_LEAD_MS ?? 30_000)

/**
 * How long an occurrence may sit unclaimed before it is written off.
 *
 * This is the guard that keeps a broken sandbox from becoming a silent one. A
 * tenant whose plugin never claims gets a wake call every tick until this
 * elapses, then one 'lost' row and an advanced series — so the failure appears
 * in their own list, the deployment stops asking for a machine nobody is
 * using, and the next occurrence still gets its chance.
 */
const MISS_AFTER_MS = Number(process.env.SCHEDULER_MISS_AFTER_MS ?? 10 * 60 * 1000)

/**
 * How long a claimed run may stay open before it is called lost.
 *
 * A claim that never reports is a sandbox that died mid-turn, which is not
 * rare: the machine can be reclaimed, restarted, or rebuilt under it. Written
 * off rather than retried, because the turn may well have happened — a
 * duplicate is a second execution of a side effect, and a miss the tenant can
 * see is the recoverable one of the two.
 */
const RUN_DEADLINE_MS = Number(process.env.SCHEDULER_RUN_DEADLINE_MS ?? 60 * 60 * 1000)

/**
 * Ask the gateway for a machine.
 *
 * The whole message is a tenant. No occurrence, no prompt, no task id: the
 * gateway is not being told what to do, it is being told somebody needs their
 * sandbox, which is a sentence it already knows how to act on. Everything
 * about the task itself reaches the plugin from this service directly.
 *
 * @param {string} username - the tenant whose machine is wanted.
 * @returns {Promise<boolean>} whether the gateway accepted.
 */
async function wake(username) {
  const base = process.env.GATEWAY_INTERNAL_URL || 'http://gateway:8080'
  const secret = process.env.INTERNAL_SHARED_SECRET ?? ''
  if (secret === '') {
    // Refused rather than attempted. An unauthenticated call would be answered
    // with the same 404 a wrong secret gets, and the log line would say the
    // endpoint is missing when the deployment is simply misconfigured.
    console.error('scheduler: INTERNAL_SHARED_SECRET is unset; no machine can be woken')
    return false
  }
  try {
    const response = await fetch(`${base}/_internal/wake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ username }),
      signal: AbortSignal.timeout(30_000),
    })
    if (response.status === 404) {
      console.error('scheduler: the gateway does not accept /_internal/wake (secret unset there, or an older image)')
      return false
    }
    return response.ok
  } catch (error) {
    console.error(`scheduler: waking ${username} failed: ${error.message}`)
    return false
  }
}

/**
 * Wake every tenant with an occurrence inside the lead.
 *
 * One wake per tenant per tick, not one per task: a tenant with four tasks due
 * at nine has one machine, and asking four times for it is four ways to lose
 * the same race.
 *
 * @param {import('pg').Pool} db - the connected pool.
 * @returns {Promise<number>} how many tenants were asked for.
 */
export async function sweepDue(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT username
       FROM scheduled_tasks
      WHERE enabled
        AND next_run_at IS NOT NULL
        AND next_run_at <= now() + ($1::bigint * interval '1 millisecond')`,
    [WAKE_LEAD_MS],
  )
  // Sequential rather than concurrent. The gateway creates a machine per call
  // and a hundred at once is a thundering herd against the sandbox runtime;
  // the sweep has a whole tick to get through its list, and a tenant woken two
  // seconds late is indistinguishable from one woken on time.
  let asked = 0
  for (const row of rows) {
    if (await wake(row.username)) asked += 1
  }
  return asked
}

/**
 * Write off occurrences nobody claimed, and advance past them.
 *
 * The advance is the important half. Without it a missed occurrence stays due
 * forever, the sweep asks for that tenant's machine every tick for the rest of
 * the deployment's life, and the task never reaches its next occurrence
 * either.
 *
 * @param {import('pg').Pool} db - the connected pool.
 * @returns {Promise<number>} how many occurrences were written off.
 */
export async function sweepMissed(db) {
  const { rows } = await db.query(
    `SELECT id, kind, rule, time_zone, next_run_at
       FROM scheduled_tasks
      WHERE enabled
        AND next_run_at IS NOT NULL
        AND next_run_at < now() - ($1::bigint * interval '1 millisecond')`,
    [MISS_AFTER_MS],
  )

  let written = 0
  for (const task of rows) {
    const occurrence = task.next_run_at
    const following = nextOccurrence(task, occurrence)
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      // ON CONFLICT DO NOTHING, because the sandbox may have claimed this
      // occurrence between the select above and here — in which case the run
      // is somebody else's and only the advance below is ours to do, and the
      // WHERE on next_run_at makes even that a no-op.
      const claimed = await client.query(
        `INSERT INTO scheduled_runs (task_id, occurrence_at, finished_at, status, detail)
         VALUES ($1, $2, now(), 'lost', 'no sandbox claimed this occurrence')
         ON CONFLICT (task_id, occurrence_at) DO NOTHING
         RETURNING id`,
        [task.id, occurrence],
      )
      await client.query(
        'UPDATE scheduled_tasks SET next_run_at = $2, updated_at = now() WHERE id = $1 AND next_run_at = $3',
        [task.id, following, occurrence],
      )
      await client.query('COMMIT')
      if (claimed.rows.length > 0) written += 1
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      console.error(`scheduler: writing off ${task.id} failed: ${error.message}`)
    } finally {
      client.release()
    }
  }
  return written
}

/**
 * Close claims that never reported.
 *
 * @param {import('pg').Pool} db - the connected pool.
 * @returns {Promise<number>} how many runs were closed.
 */
export async function sweepStale(db) {
  const { rowCount } = await db.query(
    `UPDATE scheduled_runs
        SET finished_at = now(), status = 'lost', detail = 'the sandbox never reported this run'
      WHERE finished_at IS NULL
        AND claimed_at < now() - ($1::bigint * interval '1 millisecond')`,
    [RUN_DEADLINE_MS],
  )
  return rowCount ?? 0
}

/**
 * Run the sweep on a timer until the process ends.
 *
 * One tick does all three in order, and a failure in one does not stop the
 * others: waking is the time-critical half and must not be held up by a write
 * that is only bookkeeping.
 *
 * @param {import('pg').Pool} db - the connected pool.
 * @returns {() => void} stops the timer.
 */
export function start(db) {
  let running = false
  const tick = async () => {
    // A tick that overlaps its predecessor would ask for the same machines
    // twice while the first round is still walking its list.
    if (running) return
    running = true
    try {
      const missed = await sweepMissed(db).catch((error) => {
        console.error(`scheduler: the missed sweep failed: ${error.message}`)
        return 0
      })
      const stale = await sweepStale(db).catch((error) => {
        console.error(`scheduler: the stale sweep failed: ${error.message}`)
        return 0
      })
      await sweepDue(db).catch((error) => {
        console.error(`scheduler: the due sweep failed: ${error.message}`)
      })
      if (missed > 0) console.log(`scheduler: wrote off ${missed} occurrence(s) nobody claimed`)
      if (stale > 0) console.log(`scheduler: closed ${stale} run(s) that never reported`)
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => { void tick() }, TICK_MS)
  // Not unref'd: this timer IS the service. A process that kept running with
  // it collected would answer every API call correctly and silently never wake
  // anybody, which is the failure this whole design exists to make impossible.
  void tick()
  return () => { clearInterval(timer) }
}
