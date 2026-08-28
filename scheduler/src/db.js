/**
 * The scheduler's own tables, in the deployment's one database.
 *
 * A second store was considered and refused for the reason the first one was:
 * it would mean a second backup, a second failure mode, and two answers to "is
 * this deployment's data safe" instead of one. So these live beside the
 * gateway's, applied by this service at startup the way the gateway applies
 * its own.
 *
 * They are this service's tables and nothing else queries them —
 * `scripts/check-scheduler-boundary.mjs` holds the gateway to that. The one
 * place the boundary is deliberately crossed is the foreign key below, and the
 * reason is in its comment.
 *
 * @module db
 */

import process from 'node:process'
import pg from 'pg'

/**
 * The schema, applied on every boot.
 *
 * Declared once, in the shape it has now, the way `gateway/src/db.js` declares
 * its own: there is no migration history here because there has not been a
 * release to be compatible with. `IF NOT EXISTS` throughout is what makes
 * applying it to a database that already has it a no-op.
 */
const SCHEMA = `
-- One scheduled task.
--
-- \`username\` is the account's address, which is how the gateway names a
-- tenant everywhere else. The foreign key is the one place this service
-- reaches into the gateway's schema, and it is worth the coupling: a task that
-- outlived its owner would go on waking machines and spending model tokens for
-- an account that no longer exists, and — worse — would belong to whoever
-- registered that address next. Every other per-tenant table in this
-- deployment cascades from accounts for the same reason, and the alternative
-- is asking \`erase.js\` to know about a service it otherwise does not.
--
-- \`rule\` holds only what its kind needs: an \`at\` task the instant, an
-- \`every\` task its interval in seconds, a \`cron\` task its expression. The
-- kind is a column rather than something read out of the json, because every
-- query that decides anything decides on it.
--
-- \`time_zone\` is an IANA zone and is what a cron rule is interpreted in.
-- Stored per task rather than per account: somebody who travels does not want
-- their morning report to move, and somebody who does want that can say so by
-- editing the task.
--
-- \`next_run_at\` is the one column the sweep reads, and null means there is
-- nothing further to do — a fired one-shot, or a task whose rule can no longer
-- produce an occurrence. It is advanced when a run is claimed and never when
-- one completes, so a run that hangs cannot queue every later occurrence
-- behind itself.
--
-- (No backticks in here: this string is a template literal, and one would end
-- the schema early — which fails at boot, on the statement after it.)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id          uuid        PRIMARY KEY,
  username    text        NOT NULL REFERENCES accounts(email) ON DELETE CASCADE ON UPDATE CASCADE,
  title       text        NOT NULL,
  prompt      text        NOT NULL,
  kind        text        NOT NULL,
  rule        jsonb       NOT NULL,
  time_zone   text        NOT NULL DEFAULT 'UTC',
  enabled     boolean     NOT NULL DEFAULT true,
  next_run_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The sweep asks one question, once a tick, and this is the index for it.
CREATE INDEX IF NOT EXISTS scheduled_tasks_due
  ON scheduled_tasks (next_run_at)
  WHERE enabled AND next_run_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS scheduled_tasks_owner ON scheduled_tasks (username);

-- What happened on one occurrence.
--
-- The unique key on (task, occurrence) is not bookkeeping — it is the thing
-- that makes a run happen at most once. The plugin claims an occurrence by
-- inserting here before it starts, so a second claim for the same instant
-- conflicts and is told to stand down. That covers the case this design is
-- most exposed to: a sandbox that was restarted between the claim and the
-- work, whose replacement folds the same task list and sees the same
-- occurrence overdue.
--
-- \`status\` is 'running' until something says otherwise. 'lost' is written by
-- the sweep, not by a reporter: it is what a claim that never came back looks
-- like, and it is recorded rather than retried because a run spends model
-- tokens and writes to a tenant's workspace — a duplicate is a second
-- execution of a side effect, and a miss the tenant can see is the recoverable
-- one of the two.
CREATE TABLE IF NOT EXISTS scheduled_runs (
  id            bigserial   PRIMARY KEY,
  task_id       uuid        NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  occurrence_at timestamptz NOT NULL,
  claimed_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text        NOT NULL DEFAULT 'running',
  detail        text,
  session_id    text,
  UNIQUE (task_id, occurrence_at)
);

-- Read newest-first, per task, which is the only way anyone reads these.
CREATE INDEX IF NOT EXISTS scheduled_runs_recent ON scheduled_runs (task_id, occurrence_at DESC);

-- Claims that never came back, for the sweep to find.
CREATE INDEX IF NOT EXISTS scheduled_runs_open ON scheduled_runs (claimed_at) WHERE finished_at IS NULL;
`

/**
 * Connect, apply the schema, and hand back the pool.
 *
 * Connected before the server listens, for the reason the gateway does the
 * same: a scheduler that cannot reach its store knows about no tasks at all,
 * and starting anyway would look exactly like a deployment where nobody had
 * scheduled anything.
 *
 * @returns {Promise<import('pg').Pool>} the connected pool.
 * @throws {Error} when the database cannot be reached or the schema cannot be applied.
 */
export async function connect() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://dsh:dsh@postgres:5432/dsh',
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
  })
  pool.on('error', (error) => { console.error(`scheduler: postgres: ${error.message}`) })

  await pool.query(SCHEMA)
  return pool
}
