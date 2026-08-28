# Scheduled tasks

English | [中文](scheduled-tasks.zh.md)

A tenant asks their agent to do something later — once, at a time, or on a
schedule — and it happens whether or not they are watching, and whether or not
their sandbox exists at that moment. This page says where each part of that
lives, why the clock is not in either of the two obvious places, and what a due
occurrence actually does.

Nothing here is built yet. It is written before the code because the shape is
the expensive decision: the clock's home decides what can be recovered after a
restart, and moving it later means moving the durable state with it.

## In one sentence

**One service owns when, the gateway owns identity and waking, and a plugin owns
what happens once the machine is up.**

That sentence is the test. A change is asked which of the three it is; a change
that is two of them is in the wrong place.

## Why the clock cannot live in the sandbox

The harness already ships `@deepseek-ai/dsh-schedule`, and this deployment
already has it installed — it arrives as a dependency of `@deepseek-ai/dsh` —
but no composition mounts it. That is deliberate, and the reason is in its own
documentation:

- **Session-local delivery only.** A reminder runs on time only while its
  original Session is live; a cold Session receives no external notification and
  processes an overdue record only after resume.
- **Load-order boundary.** The plugin does not scan or adopt Agents that were
  already live when it loaded.

So its state is durable — the record is in the Session event log, on the volume
— but recovery is lazy. A sandbox that restarts reads nothing until somebody
opens that conversation again. For a desktop where dsh runs beside the person
using it, that is the correct design. Here, a sandbox is reclaimed five minutes
after the tab closes, so "while the Session is live" is close to "while somebody
is watching", which is the one case a scheduled task does not need.

The deeper reason survives even if sandboxes were immortal. A clock inside each
sandbox is one clock per tenant, and then **no component can answer "what fires
in the next five minutes"** — the answer is spread across two thousand
processes, most of them not running. Scheduling is a single ordered table read
by one reader, which is not a thing a per-tenant process can be.

`dsh-schedule` stays unmounted rather than mounted-and-worked-around. Two
records of one reminder — one in a Session log, one in a database — become two
answers to "did it run", and the tenant cannot tell which is current.

## Why the clock does not live in the gateway either

The gateway is the only component that can start a sandbox, so the trigger has
to reach it. That makes it the tempting home, and it is the wrong one.

`gateway/` authenticates every tenant and holds the Docker socket, which is
host-root-equivalent. What a scheduler needs is a database, a clock, and a way
to say "now". It needs no Docker socket, no tenant credentials, and no browser
surface. That is a strictly smaller set of privileges, and this repository has
made this call once already: the operator's console is its own service with its
own credential rather than a section of the gateway.

There is a second, more practical reason. The scheduler is the part of this
feature that will keep changing — time zones, daylight saving, the edges of cron
expressions, catch-up policy — and the gateway is the sign-in path. A component
that changes often should not share a process with the one whose failure signs
everybody out.

So: a fifth service, `scheduler/`, on the internal network only. No nginx
location points at it and no browser reaches it.

## The four parts and what each owns

| Part | Owns | Never knows |
|---|---|---|
| `scheduler/` | The task table, cron and interval rules, next-occurrence arithmetic, catch-up policy, run history | Who a tenant is beyond an opaque id; how a sandbox starts |
| `gateway/` | Which sandbox belongs to whom, starting one, how long that takes | What a cron expression means; what a task's prompt says |
| `packages/dsh-scheduled-tasks` | The three tools the model sees, and turning a due occurrence into a turn | When anything is due |
| Postgres | One store, as ever | — |

The gateway holds **no cron code and no query against the task table.** That is
enforceable rather than remembered: a check greps `gateway/src` for the task
table names and for a cron dependency, and fails on either.

The scheduler's tables live in the deployment's one database, applied by its own
`db.js` at boot the way the gateway's are. A second store was considered and
refused for the reason the first one was: it would mean a second backup, a
second failure mode, and two answers to "is this deployment's data safe".

## Three paths, and each uses the shape that fits it

**Writing — the sandbox asks, over HTTP.** The plugin's tools decide nothing.
They POST to the gateway with `x-sandbox-id` and `x-sandbox-token`, the pair
`/_tunnel` already authorizes, and the gateway resolves the owning tenant from
the `sandboxes` table. **The sandbox never names a tenant**, so a compromised one
cannot write into somebody else's schedule. The gateway stamps the tenant and
that tenant's entitlement record onto the request and forwards it to the
scheduler, which validates the rule, computes the first occurrence, and answers.
The gateway reads the payload only far enough to relay it.

This needs one new variable in the sandbox environment, beside
`GATEWAY_TUNNEL_URL` in `sandboxes.js`. It is passed explicitly rather than
derived from the tunnel URL: deriving `http` from `ws` is right until a
deployment puts the tunnel behind a path or a second hostname, and then it is
wrong in a way that appears only in production.

**Waking — the scheduler asks the gateway for a machine, and that is the entire
message.** `POST /_internal/wake` carries a username. No task, no occurrence, no
prompt, no instruction about what should happen next. The gateway calls
`ensure()` and answers.

An earlier draft had the gateway also push a frame down the tunnel to say "this
occurrence is due", and dropping it removed a whole mechanism: the tunnel
protocol needs no new frame kind, `dsh-gateway-tunnel` needs no change, and the
gateway never learns what a tenant's task says. Everything that idea bought is
already covered by the plugin fetching on startup — because the wake is what
makes a startup happen.

**Running — the plugin pulls, then reports.** On starting, the plugin fetches
the tenant's whole list and holds its own timers for as long as it lives. So a
tenant with frequent tasks costs one wake and then nothing: the machine stays up
because it keeps becoming busy, and the server is not involved again until it
goes away. That is not a special case in the code — waking an already-running
sandbox is a no-op, and the plugin's timer was going to fire either way.

The same fetch is what recovers work missed while the machine was down, which is
why it is the startup path rather than a second mechanism exercised less often.
The plugin re-reads on four occasions and each is the others' backstop: at
startup, after a task is written, after every run, and on a slow heartbeat that
catches a change made from another tab.

The lead the scheduler wakes on has one hard constraint: it must stay under
`SANDBOX_DEPARTED_TTL_MS`, five minutes by default. A machine started earlier
than that, with no browser attached and no agent running, is reclaimed by the
idle sweep before its own task arrives.

## What a due occurrence does

The plugin creates a **fresh session** and prompts it, rather than resuming the
session the task was created in.

Both were considered. Resuming keeps context, which is what makes a reminder
feel like a reminder — and it grows one transcript without limit, makes every
run depend on an old Session log still being loadable, and puts a month of
unrelated history in front of a model asked to check one thing. A fresh session
is a clean, readable record of exactly what this run did, and depends on nothing
but the task row.

The cost is stated rather than hidden: **runs do not remember each other.** A
task that needs to know what the last run found has to write it into the
workspace, which is durable and which the next run can read.

While the turn runs, the tunnel reports `activity` and the idle sweep skips the
sandbox — `presence?.busy === true` is checked before either TTL. When it
finishes, nothing is attached, and the machine is reclaimed by the ordinary
sweep. Nothing here needs a special case.

## When runs are frequent

A task whose interval is shorter than the idle sweep's patience never lets its
machine go. The wake step then does nothing on most occurrences: the sandbox is
already up, the gateway skips to the nudge, and what is left looks like a timer
inside a process that happens to still be running.

That collapse is the design working rather than failing. Waking is a conditional
step, asked once per occurrence — is this tenant's machine up? — so the two
regimes are one code path with a branch in it and not two designs. What does not
change is where the truth is: the task, its rule, and the decision to fire are in
the scheduler either way, and a machine that dies mid-stretch is recovered by the
same path as one that was never up.

What is wrong is the boundary. Today it falls out of
`SANDBOX_DEPARTED_TTL_MS`, a constant chosen for something unrelated — how long
to keep a machine after somebody closes their tab. An operator lowering it from
five minutes to two, for reasons that have nothing to do with scheduling,
silently moves a class of tasks from warm to a cold start on every run. Two
knobs that were never meant to interact end up deciding the cost and the latency
of a feature neither of them names.

The correction is not a mechanism. **Destroying a machine stays exactly what it
is today** — idle, no browser attached, timeout — and no part of this feature
touches it. A rule was drafted where the gateway released a sandbox as soon as a
scheduled run finished, to stop each run leaking a departed TTL of machine time.
It was dropped, and the reason is worth keeping: the gateway would have had to
know that a run had finished, which means knowing a run had started, which is
the first crack in "the gateway only wakes". Five minutes of machine time is
cheaper than that.

**The shortest allowed interval is about residency, not latency.** Waking is
seconds here — the gateway calls `ensure()` and a sandbox dials in well inside
its own timeout — so the floor is not paying for the wake. What it decides is
whether a schedule can hold a machine permanently: an interval under the
departed TTL means the sandbox is busy again before the idle sweep reaches it,
and the tenant has a resident machine they never asked for and would not think
to account for. `entitlements.js` therefore puts the free floor well above the
TTL and the paid floor at it, so holding a machine is a choice somebody made
rather than a side effect of a number they picked.

**Below the floor is not a scheduled task.** Work that has to happen every thirty
seconds wants a process, not a schedule, and dsh already has one: `ctx.jobs` is
mounted, and `job_list`, `job_output` and `job_kill` are already in front of the
model. Its honesty is the point — a job lives in memory and dies with the
sandbox, so asking for one is asking for a machine that stays up, which is a
decision a tenant makes and pays for explicitly rather than a side effect of
setting an interval too low.

## At most once, and a miss is recorded

An occurrence is dispatched **at most once**, and one that did not happen is
written down as not having happened.

The alternative — retry until acknowledged — is wrong for this payload. A run
spends model tokens and writes to the tenant's workspace, so a duplicate is not
a repeated message but a second execution of a side effect. A miss the tenant
can see is recoverable; a silent double run is not.

Concretely: the scheduler advances `next_run_at` when the gateway answers
`accepted`, and records that occurrence as in flight with a deadline. An outcome
that arrives writes it. A deadline that passes with no outcome writes `lost` —
which is what a gateway restart between accepting and delivering looks like, and
it is visible to the tenant rather than inferred from an empty transcript.
Advancing at dispatch rather than at completion is what stops a run that hangs
from queueing every later occurrence behind it.

Missed occurrences are not replayed. A deployment down for six hours runs each
task once when it comes back, at its next occurrence, not six times — the same
rule the harness's own scheduler settled on, for the same reason.

## What a tenant is allowed

A scheduled task spends model tokens with nobody watching, which makes it the
first thing in this deployment that can cost money while its owner is asleep.
Three limits, all resolved from `entitlements.js`: how many tasks an account may
hold, the shortest interval between occurrences, and how many runs a day.

The gateway resolves them, because that is where entitlements already resolve,
and attaches them to the relayed request. The scheduler enforces them, because
enforcement means comparing against a cron rule and the gateway does not know
what one is. `check-entitlements.mjs` requires that a field declared there is
read somewhere in `gateway/src`; attaching it is that read.

## Where it is visible

Two surfaces, and the split follows from the sandbox being off most of the time.

The **gateway serves the list**, on its own page. It is the only surface that
works when the machine is not running, which is exactly when a tenant asks why
something did not happen. It shows each task, its next occurrence, and the
outcome of its last few runs, and it can delete one.

The **shell shows the same list, read-only**, from the plugin, beside the three
tools. A tenant looking at their conversation should not have to leave it to see
what is scheduled; a tenant whose sandbox is gone should not have to start one.

## What is deliberately not here

| Not here | Why |
|---|---|
| Mounting `@deepseek-ai/dsh-schedule` | Two durable records of one reminder; see above |
| Cron in the sandbox or the gateway | One clock, and not in the process holding the Docker socket |
| Retry until acknowledged | A duplicate run is a duplicate side effect |
| Replaying a missed backlog | Six hours down is not six runs |
| Sub-minute schedules | Waking a machine takes tens of seconds; a schedule finer than the wake is a promise with no mechanism |
| Triggers other than time | A webhook or a file-change trigger is a different subject with a different failure model, and would fold into this one before either was finished |

## What it is made of

- `scheduler/` — its own directory and image: `src/server.js` (an internal API,
  no public surface), `src/db.js` (its own tables), `src/clock.js` (the sweep),
  `src/rules.js` (the arithmetic). One dependency for cron parsing, in this
  service only, and nothing that could reach a sandbox.
- `gateway/src/schedules.js` — the relay, plus two routes in `server.js`:
  `/schedule/*` for a tenant's browser and `/_sandbox/schedule/*` for their
  sandbox. `/_internal/wake` is the third, on the shared-secret pattern that
  answers 404 rather than 403 to a wrong secret.
- `packages/dsh-scheduled-tasks` — the sixth plugin. A new package rather than
  surface on an existing one: take the gateway away and none of it works, which
  rules out `dsh-sandbox-host`, and it is not who is signed in, which rules out
  `dsh-tenant-account`.
- Nothing in `packages/tunnel-protocol` or `packages/dsh-gateway-tunnel`. The
  transport was going to grow a frame kind and does not have to.

Two decisions inside the plugin that the shape above does not force:

**One timer, not one per task.** It arms the earliest occurrence and recomputes
after it fires. A timer per task is a set to keep in step with every edit, and
the first missed cancellation is a task that goes on firing after it was
deleted. The wait is split against Node's 32-bit timer range and the wall clock
is re-read after every wake — a delay past that range fires IMMEDIATELY rather
than late, which would make a monthly task run every tick until the month
arrived.

**Runs are serialized.** Two turns writing one workspace is a fight nobody asked
for, and a scheduled task is never in a hurry.

## What happens when the plugin cannot reach the server

It stops firing, after two missed refreshes.

This is the counter-intuitive one. An offline plugin still holds a perfectly
good list, and running from it looks like resilience — but a task the tenant
deleted an hour ago is still in that list, and every occurrence of it spends
model tokens on work nobody wants any more. Firing needs an authorisation recent
enough to be worth acting on, not a copy that was once true.

Reporting is the other direction and has no such problem, so an outcome is
retried rather than dropped.

## How it is verified

Two gates decide from the tree alone.

`scripts/check-scheduler-boundary.mjs` holds the split: no cron dependency and
no scheduler table name anywhere under `gateway/src`, and nothing in the
scheduler's dependencies that could reach a sandbox. Nobody moves a scheduler
wholesale — somebody adds one convenient query, or imports a parser to show a
next occurrence without a round trip, and each is one line that looks harmless
in review.

`scripts/check-rules.mjs` holds the arithmetic, which it can because
`src/rules.js` is pure. Its cases are the failures that do not announce
themselves: nine in the morning has to stay nine in the morning across both
daylight-saving boundaries, and an interval series has to stay on its creation
anchor and jump straight past a gap rather than replaying it. A rule that throws
is found in a minute; a rule that runs a tenant's morning report an hour early
for half the year is found in March, by them.

The rest needs a running deployment. `verify/verify-schedule.mjs`, and its shape
is fixed by what is worth proving: create a task, **destroy the sandbox**, and
then wait. A pass means the machine came back on its own and the turn ran.
Anything that does not destroy the sandbox first proves only the easy half — and
that half is the one a deployment with frequent tasks exercises constantly,
while the cold path is the one that rots.
