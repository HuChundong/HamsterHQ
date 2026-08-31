/**
 * Scheduled tasks, host half: the only thing in this deployment that fires one.
 *
 * The durable list lives in the scheduler service, outside this machine,
 * because a sandbox is reclaimed minutes after its tenant closes the tab and a
 * clock inside a process that does not exist is not a clock. But the firing is
 * here, and that division is the whole design:
 *
 * **The server wakes; the sandbox fires.** When an occurrence approaches, the
 * scheduler asks the gateway for this tenant's machine and says nothing else —
 * no task, no prompt, no instruction. This plugin, on starting, fetches the
 * tenant's whole list and holds its own timers for as long as it is alive. A
 * task every three minutes therefore costs one wake and then nothing: the
 * machine stays up because it keeps becoming busy, and the server is not
 * involved again until it goes away.
 *
 * The reason to draw it there is not efficiency, it is that **there is exactly
 * one firer per tenant**, so a double run is not unlikely or deduplicated — it
 * has no second party who could start one. What the server keeps is the right
 * to notice that nothing happened: an occurrence nobody claimed is written off
 * after a margin and shows up in the tenant's own list, which is why liveness
 * is never consulted anywhere in this design.
 *
 * ## How a run happens
 *
 * Through the public SessionController service: create a session, then prompt
 * it. The controller resolves the agent preset and composition just as it does
 * for browser calls. No private agent construction or wire protocol is copied.
 *
 * ## What it does when it cannot reach the server
 *
 * It stops firing. That is deliberate and it is the counter-intuitive half: an
 * offline plugin still holds a perfectly good list, and running from it feels
 * like resilience. It is not — a task the tenant deleted an hour ago is still
 * in that list, and every occurrence of it spends model tokens on work nobody
 * asked for any more. Firing needs an authorisation recent enough to be worth
 * acting on, not a copy that was once true.
 *
 * @module dsh-scheduled-tasks
 */

import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'scheduled-tasks'

/**
 * `timer` is a correctness constraint and not an ordering one.
 *
 * cordis refuses a service the reading context did not inject, and it refuses
 * it where the service is READ rather than at mount — so a missing `timer`
 * here would throw inside the one line that arms the next occurrence, deep in
 * an async callback where nothing catches it, and take the tenant's whole
 * backend down with it. `dsh-gateway-tunnel` has the scar; this plugin arms a
 * timer far more often than that one redials.
 */
export const inject = ['agents', 'tools', 'timer', 'sessionController']

/** How long to wait for the whole of one scheduled turn before giving up on it. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000

/**
 * The longest a single Node timer may run.
 *
 * `setTimeout` stores its delay in a 32-bit signed integer, and a delay past
 * that fires IMMEDIATELY rather than late — so a task set for the first of next
 * month would run every tick until the month arrived. Waits are split against
 * this and the wall clock is re-read after every wake, which also means a clock
 * moved backwards cannot fire an occurrence early and one moved forwards makes
 * it overdue rather than skipping it.
 */
const MAX_TIMER_MS = 2 ** 31 - 1

/** How often to re-read the list even when nothing has said it changed. */
const REFRESH_MS = 60 * 60 * 1000

/**
 * How stale the list may be before this stops firing from it.
 *
 * Two refresh intervals: one missed round is a hiccup, two is a plugin that
 * has lost touch with what its tenant currently wants.
 */
const STALE_AFTER_MS = 2 * REFRESH_MS

/** How long after a failed refresh to try again. */
const RETRY_MS = 60 * 1000

/**
 * Where the gateway is, from the URL the tunnel dials.
 *
 * Derived rather than given its own variable, because the sandbox's Rust
 * reporter already derives it exactly this way for `/_report` — a second
 * variable naming the same host is a second thing to keep in step, and the
 * first deployment to set one and not the other would have a working tunnel
 * and a silent scheduler.
 *
 * @returns {string | undefined} the gateway's HTTP origin, or nothing when the tunnel URL is unusable.
 */
function gatewayOrigin() {
  const dialed = process.env.GATEWAY_TUNNEL_URL
  if (dialed === undefined || dialed === '') return undefined
  try {
    const url = new URL(dialed)
    return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
  } catch {
    return undefined
  }
}

/**
 * Mount the schedule plane.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {{cwd?: string}} [config] - where a scheduled run's session is rooted; the working directory by default, which is where dsh roots a tenant's workspace.
 */
export function apply(ctx, config) {
  const origin = gatewayOrigin()
  const sandboxId = process.env.SANDBOX_ID
  const token = process.env.SANDBOX_TOKEN
  const cwd = config?.cwd ?? process.cwd()

  // Mounted and inert rather than throwing. This plugin is in the sandbox
  // composition unconditionally, and a deployment can legitimately run without
  // a gateway in front of it — a developer against a local dsh, for one. What
  // it must not do is take the backend down on boot because a variable it
  // wanted is absent.
  const connected = origin !== undefined && sandboxId !== undefined && token !== undefined
  if (!connected) {
    ctx.logger?.info?.('scheduled-tasks: no gateway to reach; scheduled tasks are unavailable in this sandbox')
  }

  /** The list as last read from the server. @type {object[]} */
  let tasks = []
  /** When that read succeeded, or 0 when none has. */
  let readAt = 0
  /** Cancels the armed timer, when one is armed. @type {(() => void) | undefined} */
  let disarm
  /**
   * Occurrences this process has already claimed, as `id@instant`.
   *
   * It exists only to bridge the moment between a timer firing and the refresh
   * that follows the claim: until the server's advanced `next_run_at` is read
   * back, the local list still offers the occurrence that was just taken, and
   * arming it again would spend a round trip to be told `already_claimed`.
   *
   * Pruned on every refresh, because a sandbox that lives for a week and holds
   * a five-minute task would otherwise accumulate two thousand keys nothing
   * ever reads. What is kept is what the freshly read list could still offer.
   * @type {Set<string>}
   */
  let claimed = new Set()
  /** Runs are serialized through this: two turns writing one workspace is a fight nobody asked for. */
  let queue = Promise.resolve()
  let disposed = false

  /**
   * Call the gateway's sandbox-side schedule relay.
   *
   * The tenant is never named. The gateway resolves it from the pair below and
   * puts it on the call, which is what makes this safe to expose to a machine
   * its own tenant is root inside.
   *
   * @param {string} method - the HTTP method.
   * @param {string} path - the path under the relay.
   * @param {object} [body] - the payload, for methods that take one.
   * @returns {Promise<{status: number, value: object} | undefined>} the answer, or nothing when the gateway could not be reached.
   */
  const ask = async (method, path, body) => {
    if (!connected) return undefined
    const init = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-sandbox-id': sandboxId,
        'x-sandbox-token': token,
      },
      signal: AbortSignal.timeout(20_000),
    }
    if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(body ?? {})
    try {
      const response = await fetch(`${origin}/_sandbox/schedule${path}`, init)
      return { status: response.status, value: await response.json().catch(() => ({})) }
    } catch (error) {
      ctx.logger?.warn?.(`scheduled-tasks: ${method} ${path} failed: ${error.message}`)
      return undefined
    }
  }

  /**
   * Read the tenant's list, and arm the next occurrence.
   *
   * Called on four occasions, and each is the others' backstop: at startup,
   * which is what recovers work missed while this machine was down; after a
   * task is written through the tools or the panel; after every run; and on a
   * slow heartbeat, which is what catches a change this sandbox never heard
   * about because it was made from another tab.
   *
   * @returns {Promise<boolean>} whether the read succeeded.
   */
  const refresh = async () => {
    const answer = await ask('GET', '/tasks')
    if (answer === undefined || answer.status !== 200 || answer.value?.ok !== true) {
      arm()
      return false
    }
    tasks = Array.isArray(answer.value.tasks) ? answer.value.tasks : []
    readAt = Date.now()
    // Only the keys this list could still offer are worth remembering. A claim
    // the server has already accounted for comes back as an advanced
    // `next_run_at`, and the key that guarded it can never match again.
    const live = new Set(tasks.map((task) => `${task.id}@${task.nextRunAt}`))
    claimed = new Set([...claimed].filter((key) => live.has(key)))
    arm()
    return true
  }

  /**
   * The earliest occurrence the list still holds, with its task.
   *
   * One answer, not a list: the plugin arms ONE timer, for the earliest thing,
   * and recomputes after it fires. A timer per task would be a set to keep in
   * step with every edit, and the first missed cancellation is a task that goes
   * on firing after it was deleted.
   *
   * @returns {{task: object, at: number} | undefined} the next thing to do.
   */
  const earliest = () => {
    let best
    for (const task of tasks) {
      if (task.enabled !== true || typeof task.nextRunAt !== 'string') continue
      if (claimed.has(`${task.id}@${task.nextRunAt}`)) continue
      const at = Date.parse(task.nextRunAt)
      if (Number.isNaN(at)) continue
      if (best === undefined || at < best.at) best = { task, at }
    }
    return best
  }

  /** Arm one timer for the earliest occurrence, splitting a wait Node cannot hold. */
  const arm = () => {
    disarm?.()
    disarm = undefined
    if (disposed) return

    const next = earliest()
    // Nothing to fire. The heartbeat still runs, because a task created from
    // another tab is a change this sandbox is not told about.
    const delay = next === undefined
      ? REFRESH_MS
      : Math.max(0, next.at - Date.now())

    const wait = Math.min(delay, MAX_TIMER_MS)
    const cancel = ctx.setTimeout(() => {
      disarm = undefined
      // The wall clock is re-read here rather than trusted to have advanced by
      // `wait`: a suspended machine, a corrected clock or a split wait all land
      // in this callback with the occurrence still in the future.
      const due = earliest()
      if (due === undefined || due.at > Date.now()) {
        if (Date.now() - readAt >= REFRESH_MS) void refresh()
        else arm()
        return
      }
      claimed.add(`${due.task.id}@${due.task.nextRunAt}`)
      queue = queue.then(() => fire(due.task, due.task.nextRunAt)).catch((error) => {
        ctx.logger?.error?.(`scheduled-tasks: ${due.task.id} failed: ${error.stack ?? error.message}`)
      })
      arm()
    }, wait)
    disarm = typeof cancel === 'function' ? cancel : undefined
  }

  /**
   * Claim one occurrence, run it, and say what happened.
   *
   * The claim is what decides whether this sandbox runs it at all. Another
   * sandbox for the same tenant should not exist, but "should not" is not a
   * guarantee: a machine can be rebuilt while its predecessor is still winding
   * down, and both would hold the same list with the same occurrence overdue.
   * The server's unique key on (task, occurrence) settles it, and the loser is
   * told plainly rather than racing.
   *
   * @param {object} task - the task as the server described it.
   * @param {string} occurrenceAt - the instant being claimed.
   * @returns {Promise<void>} when the run has been reported.
   */
  const fire = async (task, occurrenceAt) => {
    if (Date.now() - readAt > STALE_AFTER_MS) {
      ctx.logger?.warn?.('scheduled-tasks: the list is too old to act on; not firing')
      return
    }

    const claim = await ask('POST', `/tasks/${task.id}/claim`, { occurrenceAt })
    if (claim === undefined) return
    if (claim.status !== 200 || claim.value?.ok !== true) {
      // 409 is the ordinary outcome of a race and not a failure worth a line
      // at error level; anything else is worth knowing about.
      const code = claim.value?.code ?? String(claim.status)
      if (code !== 'already_claimed') ctx.logger?.warn?.(`scheduled-tasks: ${task.id} was not claimed: ${code}`)
      void refresh()
      return
    }

    const runId = claim.value.runId
    const prompt = claim.value.task?.prompt ?? task.prompt
    ctx.logger?.info?.(`scheduled-tasks: running ${task.id} for ${occurrenceAt}`)

    let outcome = { status: 'ok', detail: null, sessionId: null }
    try {
      outcome = await run(prompt)
    } catch (error) {
      outcome = { status: 'failed', detail: error.message, sessionId: null }
    }
    await ask('POST', `/runs/${runId}/finish`, outcome)
    // The server advanced the series when it granted the claim, so this read
    // is what puts the following occurrence in front of the timer.
    await refresh()
  }

  /**
   * Open a fresh session and give it the task's prompt.
   *
   * Fresh rather than resuming the session the task was written in, and the
   * trade is stated where it is made: a run is then a clean transcript of
   * exactly this occurrence, depending on nothing but the task row — and runs
   * do not remember each other. A task that needs to know what the last one
   * found writes it into the workspace, which is durable and which the next
   * run can read.
   *
   * @param {string} prompt - what the agent is asked to do.
   * @returns {Promise<{status: string, detail: string|null, sessionId: string|null}>} what to report.
   */
  const run = async (prompt) => {
    const { sessionId } = await ctx.sessionController.create({ cwd })

    // Watching for the turn to end has to be armed BEFORE the prompt: the
    // agent can go running and idle again inside a fast turn, and a listener
    // attached afterwards would wait for a transition that already happened.
    const watch = whenTurnEnds(sessionId)
    try {
      await ctx.sessionController.prompt({
        requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }],
      }, AbortSignal.timeout(60_000))
    } catch (error) {
      // A prompt that never landed leaves nothing to wait for, and the watcher
      // would otherwise hold its listener and a half-hour timer until a turn
      // that will not happen times out.
      watch.abandon()
      throw error
    }

    const ended = await watch.finished
    return {
      status: ended === 'timeout' ? 'failed' : 'ok',
      detail: ended === 'timeout' ? 'the turn did not finish within the run timeout' : null,
      sessionId,
    }
  }

  /**
   * Resolve when the agent owning a session stops working.
   *
   * `agent/status` is the same signal `dsh-gateway-tunnel` reports busyness
   * from, which is what keeps a scheduled run from being reclaimed underneath
   * itself: while this is pending, the gateway's idle sweep skips this
   * sandbox.
   *
   * @param {string} sessionId - the session to watch.
   * @returns {{finished: Promise<'ended' | 'timeout'>, abandon: () => void}} the wait, and a way to stop waiting.
   */
  const whenTurnEnds = (sessionId) => {
    let started = false
    let settled = false
    /** @type {(how: 'ended' | 'timeout') => void} */
    let settle
    /** @type {(() => void) | undefined} */
    let off
    /** @type {(() => void) | undefined} */
    let cancelTimeout

    const finished = new Promise((resolve) => {
      settle = (how) => {
        if (settled) return
        settled = true
        off?.()
        cancelTimeout?.()
        resolve(how)
      }
    })

    const cancel = ctx.setTimeout(() => { settle('timeout') }, RUN_TIMEOUT_MS)
    cancelTimeout = typeof cancel === 'function' ? cancel : undefined
    const stop = ctx.on('agent/status', ({ agent, status }) => {
      if (agent?.session?.id !== sessionId) return
      if (status === 'running') {
        started = true
        return
      }
      // An idle report before the turn began is the agent settling into
      // existence, not the work finishing.
      if (started) settle('ended')
    })
    off = typeof stop === 'function' ? stop : undefined

    return { finished, abandon: () => { settle('timeout') } }
  }

  // The tools. They decide nothing: every rule is validated where the rule
  // lives, so a limit changed in the console applies to the next call without
  // this file knowing a limit exists.
  ctx.tools.register(defineTool({
    name: 'schedule_create',
    description: [
      'Schedule work to happen later, once or repeatedly, whether or not the user is present.',
      'The task runs in a NEW conversation with no memory of this one, so the prompt must stand on its own:',
      'say what to do and where, not "the file we discussed".',
      'Choose exactly one kind. `at` is a single RFC 3339 instant that must carry Z or a numeric offset.',
      '`every` is a fixed interval in seconds. `cron` is a five-field expression read in `time_zone`.',
    ].join(' '),
    parameters: {
      title: { type: 'string', required: true, description: 'A short name the user will see in their schedule list.' },
      prompt: { type: 'string', required: true, description: 'What to do when it runs, written to be read with no prior context.' },
      kind: { type: 'string', required: true, enum: ['at', 'every', 'cron'], description: 'at (once) | every (fixed interval) | cron (calendar rule).' },
      at: { type: 'string', description: 'For kind=at: the instant, e.g. 2026-09-01T09:00:00+08:00. An offset or Z is required.' },
      seconds: { type: 'integer', description: 'For kind=every: the interval in seconds.' },
      expression: { type: 'string', description: 'For kind=cron: a five-field expression, e.g. 0 9 * * 1-5.' },
      time_zone: { type: 'string', description: 'IANA zone a cron expression is read in, e.g. Asia/Shanghai. UTC when omitted.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          nextRunAt: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Scheduled "${value.title}", next at ${value.nextRunAt ?? 'never'}.` }],
    },
    async execute(args) {
      const rule = args.kind === 'at'
        ? { at: args.at }
        : args.kind === 'every' ? { seconds: args.seconds } : { expression: args.expression }
      const answer = await ask('POST', '/tasks', {
        task: { title: args.title, prompt: args.prompt, kind: args.kind, rule, timeZone: args.time_zone },
      })
      if (answer === undefined) throw new Error('the schedule service is not reachable from this sandbox')
      if (answer.value?.ok !== true) throw new Error(`${answer.value?.code ?? 'error'}: ${answer.value?.message ?? 'the task was refused'}`)
      await refresh()
      return { id: answer.value.task.id, title: answer.value.task.title, nextRunAt: answer.value.task.nextRunAt }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'schedule_list',
    description: 'List this user\'s scheduled tasks, when each next runs, and how the last run went.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } } } },
      render: (_args, value) => [{
        type: 'text',
        text: value.tasks.length === 0
          ? 'No scheduled tasks.'
          : value.tasks.map((task) => `${task.id} — ${task.title} — ${task.enabled ? `next ${task.nextRunAt ?? 'never'}` : 'disabled'}`).join('\n'),
      }],
    },
    async execute() {
      if (!await refresh()) throw new Error('the schedule service is not reachable from this sandbox')
      return { tasks }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'schedule_delete',
    description: 'Delete one scheduled task by its id. Use schedule_list first if the id is not already known.',
    parameters: { id: { type: 'string', required: true, description: 'The task id, as schedule_list reports it.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, deleted: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.deleted ? `Deleted ${value.id}.` : `No task ${value.id}.` }],
    },
    async execute(args) {
      const answer = await ask('DELETE', `/tasks/${encodeURIComponent(String(args.id))}`)
      if (answer === undefined) throw new Error('the schedule service is not reachable from this sandbox')
      await refresh()
      return { id: String(args.id), deleted: answer.value?.ok === true }
    },
  }))

  // The first read is what recovers work this machine was not up for. It is
  // not awaited — `apply` must not hold the composition open on a network
  // call — and a failure only means the retry below.
  const begin = () => {
    void refresh().then((ok) => {
      if (!ok && !disposed) ctx.setTimeout(begin, RETRY_MS)
    })
  }
  if (connected) begin()

  ctx.on('dispose', () => {
    disposed = true
    disarm?.()
    disarm = undefined
  })
}
