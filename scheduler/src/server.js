/**
 * The scheduler's API, which no browser and no sandbox ever reaches directly.
 *
 * Every caller is the gateway. That is not a convention to be polite about —
 * it is the authentication model. This service has no idea who a tenant is; it
 * is told a username by the one component that can prove one, over a shared
 * secret, on a network no tenant is on. Nothing here is published through
 * nginx, and `compose.yml` gives it no host port.
 *
 * Which means two rules for everything below:
 *
 * - **Every query is scoped by username, including the ones that already have
 *   a primary key.** `DELETE /tasks/:id` still says `AND username = $2`. The id
 *   is a uuid and unguessable, so this buys nothing against a stranger — it
 *   buys everything against the gateway relaying the wrong tenant, which is a
 *   one-line mistake in a component that handles two identities at once.
 * - **A wrong or missing secret answers 404**, the way the gateway's own
 *   internal endpoint does, and a deployment that leaves the secret unset
 *   refuses every call rather than trusting whoever asks.
 *
 * @module server
 */

import { randomUUID } from 'node:crypto'
import http from 'node:http'
import process from 'node:process'
import { connect } from './db.js'
import * as clock from './clock.js'
import { RuleError, normalize, nextOccurrence } from './rules.js'

/** Where this service listens. */
const PORT = Number(process.env.SCHEDULER_PORT ?? 8092)

/** Largest request body accepted, which is a prompt and some fields. */
const BODY_LIMIT = 16 * 1024

/** How many runs a task's history returns. */
const HISTORY = 20

/**
 * Read a request body, capped.
 *
 * Destroys rather than truncates, the way the gateway's `readBody` does: a
 * caller that sent too much gets nothing back rather than a half-parsed
 * object that looked like it worked.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<object | undefined>} the parsed body, or undefined when it was too large or not JSON.
 */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) {
      req.destroy()
      return undefined
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Answer with JSON.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {number} status - the status code.
 * @param {object} value - the body.
 */
function send(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

/**
 * The shape a task is reported in, everywhere.
 *
 * One function so the tenant's list, the plugin's fetch and the console all
 * describe a task the same way. `rule` goes out as it is stored, which is what
 * lets the editing dialog put a tenant's own expression back in front of them
 * rather than a reconstruction of it.
 *
 * @param {object} row - the database row.
 * @returns {object} the wire form.
 */
function asTask(row) {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    kind: row.kind,
    rule: row.rule,
    timeZone: row.time_zone,
    enabled: row.enabled,
    nextRunAt: row.next_run_at === null ? null : row.next_run_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    lastRun: row.last_status === null || row.last_status === undefined ? null : {
      occurrenceAt: row.last_occurrence_at.toISOString(),
      status: row.last_status,
      detail: row.last_detail,
    },
  }
}

/** The columns every task read returns, with its most recent run folded in. */
const TASK_SELECT = `
  SELECT t.*, r.occurrence_at AS last_occurrence_at, r.status AS last_status, r.detail AS last_detail
    FROM scheduled_tasks t
    LEFT JOIN LATERAL (
      SELECT occurrence_at, status, detail
        FROM scheduled_runs
       WHERE task_id = t.id
       ORDER BY occurrence_at DESC
       LIMIT 1
    ) r ON true
`

/**
 * How many tasks this account already has.
 * @param {import('pg').Pool} db - the pool.
 * @param {string} username - the account.
 * @returns {Promise<number>} the count.
 */
async function countFor(db, username) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM scheduled_tasks WHERE username = $1', [username])
  return rows[0].n
}

/**
 * Serve one request.
 *
 * An ordered chain of `if`s, the way `gateway/src/server.js` routes, and for
 * the same reason: order is the routing table, and a specific path goes before
 * a general one rather than after it.
 *
 * @param {import('pg').Pool} db - the pool.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 * @returns {Promise<void>} when the response has been written.
 */
async function handle(db, req, res) {
  const url = new URL(req.url ?? '/', 'http://scheduler')
  const path = url.pathname

  // Liveness, and the one route with no secret: compose needs an answer before
  // the deployment has a secret to give it, and this says nothing.
  if (path === '/health') {
    send(res, 200, { ok: true })
    return
  }

  const expected = process.env.INTERNAL_SHARED_SECRET ?? ''
  if (expected === '' || req.headers['x-internal-secret'] !== expected) {
    // Hiding rather than announcing, like the gateway's own internal endpoint:
    // a 403 tells whoever guessed that the endpoint is real.
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }

  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req)
  if (body === undefined) {
    send(res, 400, { ok: false, code: 'bad_request', message: 'body is not JSON, or is too large' })
    return
  }

  const username = url.searchParams.get('username') ?? body.username
  if (typeof username !== 'string' || username === '') {
    send(res, 400, { ok: false, code: 'bad_request', message: 'no tenant named' })
    return
  }

  // What this tenant is allowed, resolved by the gateway and carried here.
  // Absent means unlimited, which is what a deployment with no commerce plane
  // resolves to — not zero, and not a default invented in this file.
  const limits = typeof body.limits === 'object' && body.limits !== null ? body.limits : {}

  if (path === '/tasks' && req.method === 'GET') {
    const { rows } = await db.query(`${TASK_SELECT} WHERE t.username = $1 ORDER BY t.created_at`, [username])
    send(res, 200, { ok: true, tasks: rows.map(asTask) })
    return
  }

  if (path === '/tasks' && req.method === 'POST') {
    const ceiling = Number(limits.maxScheduledTasks ?? 0)
    if (ceiling > 0 && await countFor(db, username) >= ceiling) {
      send(res, 409, { ok: false, code: 'too_many_tasks', message: `this account may hold ${ceiling} scheduled task(s)` })
      return
    }
    let fields
    try {
      fields = normalize(body.task, limits)
    } catch (error) {
      if (!(error instanceof RuleError)) throw error
      send(res, 400, { ok: false, code: error.code, message: error.message })
      return
    }
    const id = randomUUID()
    const { rows } = await db.query(
      `INSERT INTO scheduled_tasks (id, username, title, prompt, kind, rule, time_zone, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, username, fields.title, fields.prompt, fields.kind, JSON.stringify(fields.rule), fields.timeZone, fields.nextRunAt],
    )
    send(res, 200, { ok: true, task: asTask(rows[0]) })
    return
  }

  const taskMatch = /^\/tasks\/([0-9a-f-]{36})(\/claim|\/runs)?$/.exec(path)
  if (taskMatch !== null) {
    const id = taskMatch[1]
    const tail = taskMatch[2] ?? ''

    if (tail === '' && req.method === 'DELETE') {
      const { rowCount } = await db.query('DELETE FROM scheduled_tasks WHERE id = $1 AND username = $2', [id, username])
      if (rowCount === 0) {
        send(res, 404, { ok: false, code: 'not_found', message: 'no such task' })
        return
      }
      send(res, 200, { ok: true, deleted: true })
      return
    }

    if (tail === '' && req.method === 'PATCH') {
      const { rows: current } = await db.query('SELECT * FROM scheduled_tasks WHERE id = $1 AND username = $2', [id, username])
      if (current.length === 0) {
        send(res, 404, { ok: false, code: 'not_found', message: 'no such task' })
        return
      }
      const existing = current[0]

      // Enabling and editing are the same call because they are the same
      // decision from the tenant's side, and splitting them would mean a
      // dialog that saves twice.
      const enabled = typeof body.enabled === 'boolean' ? body.enabled : existing.enabled
      let fields
      if (body.task === undefined) {
        // Re-enabling alone still has to produce an occurrence: a task that
        // was disabled through the instant it was due comes back with a
        // next_run_at in the past, and the missed sweep would write it off
        // before its own timer ever saw it.
        const from = new Date()
        const following = enabled && (existing.next_run_at === null || existing.next_run_at < from)
          ? nextOccurrence(existing, from)
          : existing.next_run_at
        const { rows } = await db.query(
          `UPDATE scheduled_tasks SET enabled = $3, next_run_at = $4, updated_at = now()
            WHERE id = $1 AND username = $2 RETURNING *`,
          [id, username, enabled, following],
        )
        send(res, 200, { ok: true, task: asTask(rows[0]) })
        return
      }
      try {
        fields = normalize(body.task, limits)
      } catch (error) {
        if (!(error instanceof RuleError)) throw error
        send(res, 400, { ok: false, code: error.code, message: error.message })
        return
      }
      const { rows } = await db.query(
        `UPDATE scheduled_tasks
            SET title = $3, prompt = $4, kind = $5, rule = $6, time_zone = $7, enabled = $8, next_run_at = $9, updated_at = now()
          WHERE id = $1 AND username = $2
        RETURNING *`,
        [id, username, fields.title, fields.prompt, fields.kind, JSON.stringify(fields.rule), fields.timeZone, enabled, enabled ? fields.nextRunAt : null],
      )
      send(res, 200, { ok: true, task: asTask(rows[0]) })
      return
    }

    if (tail === '/runs' && req.method === 'GET') {
      const { rows } = await db.query(
        `SELECT r.* FROM scheduled_runs r
           JOIN scheduled_tasks t ON t.id = r.task_id
          WHERE r.task_id = $1 AND t.username = $2
          ORDER BY r.occurrence_at DESC
          LIMIT ${HISTORY}`,
        [id, username],
      )
      send(res, 200, {
        ok: true,
        runs: rows.map((row) => ({
          id: String(row.id),
          occurrenceAt: row.occurrence_at.toISOString(),
          claimedAt: row.claimed_at.toISOString(),
          finishedAt: row.finished_at === null ? null : row.finished_at.toISOString(),
          status: row.status,
          detail: row.detail,
          sessionId: row.session_id,
        })),
      })
      return
    }

    // The claim. This is the whole concurrency story of the feature: the
    // unique key on (task, occurrence) decides who runs, and everybody else is
    // told to stand down. It advances the series in the same transaction, so a
    // run that hangs cannot leave its own occurrence due — and a run that
    // finishes cannot advance it twice.
    if (tail === '/claim' && req.method === 'POST') {
      const occurrence = typeof body.occurrenceAt === 'string' ? new Date(body.occurrenceAt) : new Date(NaN)
      if (Number.isNaN(occurrence.getTime())) {
        send(res, 400, { ok: false, code: 'bad_request', message: 'occurrenceAt is not an instant' })
        return
      }
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        const { rows: found } = await client.query(
          'SELECT * FROM scheduled_tasks WHERE id = $1 AND username = $2 FOR UPDATE',
          [id, username],
        )
        if (found.length === 0) {
          await client.query('ROLLBACK')
          send(res, 404, { ok: false, code: 'not_found', message: 'no such task' })
          return
        }
        const task = found[0]
        if (!task.enabled) {
          await client.query('ROLLBACK')
          send(res, 409, { ok: false, code: 'disabled', message: 'this task is disabled' })
          return
        }

        const ceiling = Number(limits.maxScheduledRunsPerDay ?? 0)
        if (ceiling > 0) {
          const { rows: spent } = await client.query(
            `SELECT count(*)::int AS n FROM scheduled_runs r
               JOIN scheduled_tasks t ON t.id = r.task_id
              WHERE t.username = $1 AND r.claimed_at > now() - interval '1 day'`,
            [username],
          )
          if (spent[0].n >= ceiling) {
            await client.query('ROLLBACK')
            send(res, 429, { ok: false, code: 'run_budget_spent', message: `this account may run ${ceiling} scheduled task(s) a day` })
            return
          }
        }

        const { rows: claimed } = await client.query(
          `INSERT INTO scheduled_runs (task_id, occurrence_at) VALUES ($1, $2)
           ON CONFLICT (task_id, occurrence_at) DO NOTHING
           RETURNING id`,
          [id, occurrence],
        )
        if (claimed.length === 0) {
          await client.query('ROLLBACK')
          send(res, 409, { ok: false, code: 'already_claimed', message: 'another run already owns this occurrence' })
          return
        }
        const following = nextOccurrence(task, occurrence)
        await client.query(
          'UPDATE scheduled_tasks SET next_run_at = $2, updated_at = now() WHERE id = $1',
          [id, following],
        )
        await client.query('COMMIT')
        send(res, 200, {
          ok: true,
          runId: String(claimed[0].id),
          task: { id: task.id, title: task.title, prompt: task.prompt },
          nextRunAt: following === null ? null : following.toISOString(),
        })
        return
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    }
  }

  const runMatch = /^\/runs\/(\d+)\/finish$/.exec(path)
  if (runMatch !== null && req.method === 'POST') {
    const status = body.status === 'ok' || body.status === 'failed' ? body.status : 'failed'
    const detail = typeof body.detail === 'string' ? body.detail.slice(0, 2000) : null
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 200) : null
    const { rowCount } = await db.query(
      `UPDATE scheduled_runs r
          SET finished_at = now(), status = $3, detail = $4, session_id = $5
         FROM scheduled_tasks t
        WHERE r.id = $1 AND t.id = r.task_id AND t.username = $2 AND r.finished_at IS NULL`,
      [runMatch[1], username, status, detail, sessionId],
    )
    if (rowCount === 0) {
      // Already closed, most likely by the stale sweep after this sandbox went
      // quiet for an hour. Not an error the caller can act on: the work did
      // happen, and the record says otherwise. Answered plainly so a plugin
      // does not retry into a wall.
      send(res, 200, { ok: true, recorded: false })
      return
    }
    send(res, 200, { ok: true, recorded: true })
    return
  }

  send(res, 404, { ok: false, code: 'not_found', message: 'no such route' })
}

const db = await connect()
clock.start(db)

const server = http.createServer((req, res) => {
  handle(db, req, res).catch((error) => {
    console.error(`scheduler: ${req.method} ${req.url} failed: ${error.stack ?? error.message}`)
    if (!res.headersSent) send(res, 500, { ok: false, code: 'internal', message: 'the scheduler failed' })
    else res.end()
  })
})

server.listen(PORT, () => {
  console.log(`scheduler: listening on ${PORT}`)
})
