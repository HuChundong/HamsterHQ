# AGENTS.md — scheduler/

English | [中文](AGENTS.zh.md)

The clock behind scheduled tasks. Why it is a service of its own rather than a
module in the gateway, and how the three parts divide, are in
[docs/scheduled-tasks.md](../docs/scheduled-tasks.md).

## It never fires anything

This service wakes machines and writes down what did not happen. **The firing
is `packages/dsh-scheduled-tasks`, inside the sandbox, and it is the only
firer.** That is not an optimisation and it is not negotiable by a later
change: with one firer per tenant, a double run has no second party who could
start one, and a run is model tokens and writes to somebody's workspace.

Two things follow, and both look like bugs until the rule above is in mind:

- **Nothing here consults liveness.** Whether a tenant's sandbox is up is the
  gateway's knowledge and this service never asks. It calls `/_internal/wake`
  at every occurrence; if the machine is already running that call is a no-op
  and the plugin's own timer does the work. A scheduler that knew would be
  tempted to decide, and deciding is the thing it must not do.
- **An unclaimed occurrence is written off, never retried.** `sweepMissed` in
  `clock.js` records a `lost` run and advances the series. That is what keeps a
  broken sandbox from becoming a silent one, and what stops a missed occurrence
  from asking for that tenant's machine every tick forever.

## The claim is the whole concurrency story

`POST /tasks/:id/claim` inserts into `scheduled_runs`, and the unique key on
`(task_id, occurrence_at)` decides who runs. Everything else — the series
advancing, the run budget, the enabled check — happens in that same
transaction, behind `SELECT ... FOR UPDATE` on the task.

**Advance at the claim, never at the finish.** A run that hangs would otherwise
leave its own occurrence due, and every later one queues behind it.

A caller that loses the race is told `already_claimed` and stands down. It is
an ordinary outcome — a machine rebuilt while its predecessor was winding down
holds the same list — and not a failure worth a line at error level.

## Every query is scoped by username

Including the ones that already have a primary key: `DELETE /tasks/:id` still
says `AND username = $2`. The id is an unguessable uuid, so this buys nothing
against a stranger — it buys everything against the gateway relaying the wrong
tenant, which is a one-line mistake in the one component that handles two
identities at once.

This service has no way to check who anybody is. It is told a username by the
component that can prove one, over a shared secret, on a network no tenant is
on, and `compose.yml` gives it no host port at all. A wrong or missing secret
answers **404, not 403**, for the reason `/_internal/account` does.

## The rule arithmetic is pure, and that is why it is checkable

`src/rules.js` reads no clock it was not handed and writes nothing, so
`scripts/check-rules.mjs` holds it to a table of cases with no database and no
deployment — including both daylight-saving boundaries, asserted in wall-clock
terms. Everything else about this feature needs a running deployment and lives
in `verify/`.

**Keep it pure.** The moment a function in there reads `new Date()` for itself,
the cases stop being reproducible and the check becomes a check of today.

## The schema

One string in `src/db.js`, re-run at every boot with `CREATE TABLE IF NOT
EXISTS` — the same arrangement, and the same limits, as
[gateway/AGENTS.md](../gateway/AGENTS.md) describes for its own. A column added
to it appears on empty deployments and nowhere else.

The one thing worth naming here is the foreign key. `scheduled_tasks.username`
references `accounts(email)` and cascades, which is this service reaching into
a table it does not own. The alternative is a task that outlives its owner and
goes on waking machines and spending tokens for an account that no longer
exists — and, worse, belongs to whoever registers that address next.

## What it may not depend on

`e2b`, `@cubesandbox/sdk`, `ws`, `dockerode`, the tunnel protocol — anything
that could reach a sandbox. It asks the gateway for a machine and is told
nothing about what happens inside one.
`scripts/check-scheduler-boundary.mjs` asserts that, and the same check asserts
the other direction: no cron parser and no scheduler table name anywhere under
`gateway/src`.
