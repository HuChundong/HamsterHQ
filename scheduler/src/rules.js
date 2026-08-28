/**
 * What a schedule is, and when it happens next.
 *
 * Three kinds, and the split is by what the tenant actually means rather than
 * by what is easy to store:
 *
 * - `at` is one instant, once. The task is finished afterwards.
 * - `every` is a fixed interval, anchored at creation. It cannot express "at
 *   nine" and does not try to.
 * - `cron` is a calendar rule read in a named zone, which is the only one of
 *   the three that survives daylight saving meaning what a person meant.
 *
 * The harness's own scheduler stops at the first two and says so — "calendar
 * or Cron expressions are not part of the protocol" — because its state lives
 * in a session log and a session is not around to hold a calendar. Here the
 * rule is a row, so the third kind costs a dependency and nothing else.
 *
 * That dependency is deliberate. Cron looks like arithmetic until the hour a
 * zone skips in spring and the hour it repeats in autumn, and a rule read in a
 * zone is exactly where a hand-written implementation goes quietly wrong — not
 * with an exception, but by running a tenant's morning report at three in the
 * afternoon twice a year. `cron-parser` is the standard reading of the format
 * and it takes a zone.
 *
 * Everything here is pure: it reads no clock it was not handed, and it writes
 * nothing. That is what lets `check-rules.mjs` hold it to a table of cases
 * without a database or a deployment.
 *
 * @module rules
 */

import { CronExpressionParser } from 'cron-parser'

/** The kinds a task may be, which is also the set the column may hold. */
export const KINDS = ['at', 'every', 'cron']

/** Longest prompt a task may carry, in characters. */
export const MAX_PROMPT = 4000

/** Longest title a task may carry, in characters. */
export const MAX_TITLE = 120

/**
 * How far ahead a rule is allowed to point.
 *
 * Ten years, and it is a guard against arithmetic rather than a policy: a cron
 * expression that matches nothing reachable — 30 February, in effect — makes
 * the parser walk forward forever looking for an occurrence. Bounding the
 * search turns that into a rejected rule instead of a hung request.
 */
const HORIZON_MS = 10 * 365 * 24 * 60 * 60 * 1000

/**
 * A rejection, in the vocabulary the tools and the console both speak.
 *
 * Closed on purpose: a caller can branch on these, and a message that is only
 * prose is a message that changes when somebody rewords it.
 */
export class RuleError extends Error {
  /**
   * @param {string} code - one of the closed set: invalid_title, invalid_prompt, invalid_kind, invalid_rule, invalid_time_zone, not_future, frequency_too_high, unreachable_rule.
   * @param {string} message - what the caller did, for a human reading a log.
   */
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/**
 * Whether a string names a zone this runtime knows.
 *
 * Asked of the runtime rather than of a list, because the list is the
 * runtime's and a copy of it here would be wrong the first time tzdata moved.
 *
 * @param {unknown} zone - the candidate zone name.
 * @returns {boolean} whether it can be used.
 */
export function knownTimeZone(zone) {
  if (typeof zone !== 'string' || zone === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * Read an absolute instant that carries its own offset.
 *
 * The offset has to be in the string. A bare `2026-08-28T09:00:00` is not an
 * instant — it is a wall clock reading, and which instant it names depends on
 * a zone nobody stated. Accepting it would mean guessing, and the guess would
 * be the server's zone, which is the one zone that has nothing to do with the
 * person who typed it.
 *
 * @param {unknown} value - the candidate string.
 * @returns {Date} the instant.
 * @throws {RuleError} when it is not a fully qualified RFC 3339 instant.
 */
function readInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new RuleError('invalid_rule', 'at needs an RFC 3339 instant carrying Z or a numeric offset')
  }
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) throw new RuleError('invalid_rule', `at is not a real instant: ${value}`)
  return when
}

/**
 * Turn what a caller asked for into what the row holds.
 *
 * Shape first, then policy: a rule that is malformed is rejected the same way
 * whatever the tenant is entitled to, so a tier change never turns a broken
 * rule into a working one or the reverse.
 *
 * @param {object} input - the submitted task.
 * @param {string} input.title - what the tenant calls it.
 * @param {string} input.prompt - what the agent is asked to do.
 * @param {string} input.kind - one of KINDS.
 * @param {object} input.rule - the kind's own fields.
 * @param {string} [input.timeZone] - the IANA zone a cron rule is read in; UTC when absent.
 * @param {{minScheduleIntervalSeconds?: number}} [limits] - what this tenant is allowed, as `entitlements.js` resolved it.
 * @param {Date} [now] - the instant to measure "future" against; the wall clock by default.
 * @returns {{title: string, prompt: string, kind: string, rule: object, timeZone: string, nextRunAt: Date}} the row's fields and its first occurrence.
 * @throws {RuleError} when the rule cannot be stored or can never fire.
 */
export function normalize(input, limits = {}, now = new Date()) {
  const title = typeof input?.title === 'string' ? input.title.trim() : ''
  if (title === '' || title.length > MAX_TITLE) {
    throw new RuleError('invalid_title', `title must be 1 to ${MAX_TITLE} characters`)
  }
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : ''
  if (prompt === '' || prompt.length > MAX_PROMPT) {
    throw new RuleError('invalid_prompt', `prompt must be 1 to ${MAX_PROMPT} characters`)
  }
  const kind = input?.kind
  if (!KINDS.includes(kind)) throw new RuleError('invalid_kind', `kind must be one of ${KINDS.join(', ')}`)

  const timeZone = input?.timeZone ?? 'UTC'
  if (!knownTimeZone(timeZone)) throw new RuleError('invalid_time_zone', `unknown time zone: ${String(timeZone)}`)

  const minInterval = Number(limits.minScheduleIntervalSeconds ?? 0)

  if (kind === 'at') {
    const when = readInstant(input?.rule?.at)
    if (when.getTime() <= now.getTime()) throw new RuleError('not_future', 'at must be in the future')
    if (when.getTime() - now.getTime() > HORIZON_MS) throw new RuleError('invalid_rule', 'at is further ahead than this deployment schedules')
    return { title, prompt, kind, rule: { at: when.toISOString() }, timeZone, nextRunAt: when }
  }

  if (kind === 'every') {
    const seconds = input?.rule?.seconds
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      throw new RuleError('invalid_rule', 'every needs a positive whole number of seconds')
    }
    if (seconds < minInterval) {
      throw new RuleError('frequency_too_high', `this account's shortest interval is ${minInterval} seconds`)
    }
    // The anchor is stored rather than recomputed from created_at, so that the
    // series a tenant sees never moves when a row is edited for some other
    // reason. Occurrences are anchor + k * seconds, by integer arithmetic on
    // milliseconds: adding the interval to the previous occurrence instead
    // would accumulate whatever the previous one was rounded to.
    const anchor = new Date(now.getTime())
    const first = new Date(anchor.getTime() + seconds * 1000)
    return { title, prompt, kind, rule: { seconds, anchor: anchor.toISOString() }, timeZone, nextRunAt: first }
  }

  const expression = typeof input?.rule?.expression === 'string' ? input.rule.expression.trim() : ''
  if (expression === '') throw new RuleError('invalid_rule', 'cron needs an expression')
  const first = cronNext(expression, timeZone, now)
  if (first === null) throw new RuleError('unreachable_rule', 'that cron expression matches no time this deployment schedules')
  if (minInterval > 0) {
    // Two occurrences is enough to measure the tightest gap a rule can
    // produce near now, which is what the limit is actually about. A rule
    // whose gaps vary — the top of every hour but only on Mondays — is
    // measured at its tightest, which is the honest reading of "how often can
    // this cost me something".
    const second = cronNext(expression, timeZone, first)
    if (second !== null && (second.getTime() - first.getTime()) / 1000 < minInterval) {
      throw new RuleError('frequency_too_high', `this account's shortest interval is ${minInterval} seconds`)
    }
  }
  return { title, prompt, kind, rule: { expression }, timeZone, nextRunAt: first }
}

/**
 * The first occurrence a cron expression produces after an instant.
 *
 * @param {string} expression - the cron expression.
 * @param {string} timeZone - the IANA zone to read it in.
 * @param {Date} after - the instant to search from, exclusive.
 * @returns {Date | null} the occurrence, or null when the rule reaches nothing inside the horizon.
 * @throws {RuleError} when the expression cannot be parsed.
 */
function cronNext(expression, timeZone, after) {
  let iterator
  try {
    iterator = CronExpressionParser.parse(expression, { currentDate: after, tz: timeZone })
  } catch (error) {
    throw new RuleError('invalid_rule', `cron expression rejected: ${error.message}`)
  }
  let candidate
  try {
    candidate = iterator.next().toDate()
  } catch {
    // The parser walks forward looking for a match and gives up rather than
    // looping forever. An expression that reaches nothing — 31 February — ends
    // here, and it is a rejected rule and not an internal failure.
    return null
  }
  if (candidate.getTime() - after.getTime() > HORIZON_MS) return null
  return candidate
}

/**
 * The next occurrence after one that has been claimed.
 *
 * Deliberately takes the instant to search from rather than reading a clock:
 * the caller has already sampled one, and two samples inside one decision is
 * how a series skips or repeats an occurrence at a boundary.
 *
 * @param {{kind: string, rule: object, time_zone?: string, timeZone?: string}} task - the stored task.
 * @param {Date} after - search strictly after this instant.
 * @returns {Date | null} the next occurrence, or null when the task is finished.
 */
export function nextOccurrence(task, after) {
  const timeZone = task.timeZone ?? task.time_zone ?? 'UTC'
  if (task.kind === 'at') return null

  if (task.kind === 'every') {
    const seconds = Number(task.rule?.seconds)
    const anchor = new Date(task.rule?.anchor ?? 0).getTime()
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || Number.isNaN(anchor)) return null
    const step = seconds * 1000
    // Straight to the first anchor-aligned instant after `after`, rather than
    // walking the series forward. A machine that was down for six hours has
    // missed a hundred occurrences of a three-minute task, and enumerating
    // them would queue a hundred runs to say the same thing once.
    const elapsed = after.getTime() - anchor
    const passed = elapsed < 0 ? 0 : Math.floor(elapsed / step) + 1
    return new Date(anchor + passed * step)
  }

  const expression = task.rule?.expression
  if (typeof expression !== 'string' || expression === '') return null
  try {
    return cronNext(expression, timeZone, after)
  } catch {
    // A stored expression that no longer parses — a dependency upgrade that
    // narrowed the dialect — stops the task instead of faulting the sweep that
    // found it. The row stays, with a null next occurrence, which is what the
    // tenant's list shows as needing attention.
    return null
  }
}
