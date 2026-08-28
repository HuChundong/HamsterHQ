/**
 * A schedule means what a person meant by it.
 *
 * `scheduler/src/rules.js` is pure — it reads no clock it was not handed and
 * writes nothing — which is what makes this checkable from the tree, with no
 * database and no deployment. Everything else about scheduled tasks needs one
 * and lives in `verify/`.
 *
 * The cases below are chosen for the failures that do not announce themselves.
 * A rule that throws is found in a minute; a rule that runs a tenant's morning
 * report at eight for half the year is found in March, by them. So the two
 * daylight-saving boundaries are asserted in wall-clock terms — nine in the
 * morning stays nine in the morning, and the UTC instant is what moves — which
 * is the property a hand-rolled implementation gets wrong and the reason
 * `cron-parser` is a dependency rather than an afternoon's arithmetic.
 *
 * The interval cases assert the other quiet one: an interval series is
 * anchor-aligned integer arithmetic, and catching up after a long gap jumps
 * straight to the next occurrence rather than walking through the hundred that
 * were missed.
 *
 * Run: node scripts/check-rules.mjs
 */

import process from 'node:process'
import { RuleError, normalize, nextOccurrence } from '../scheduler/src/rules.js'

const problems = []

/**
 * Record a failed expectation.
 * @param {boolean} ok - whether it held.
 * @param {string} what - what was being asserted.
 */
function check(ok, what) {
  if (!ok) problems.push(what)
}

/**
 * The code a rejected rule reports, or 'accepted'.
 * @param {object} input - the submitted task.
 * @param {object} limits - what the tenant is allowed.
 * @param {Date} now - the instant to measure against.
 * @returns {string} the code.
 */
function refusal(input, limits, now) {
  try {
    normalize(input, limits, now)
    return 'accepted'
  } catch (error) {
    if (!(error instanceof RuleError)) throw error
    return error.code
  }
}

/** A task body every case shares, so each case shows only what it is about. */
const BODY = { title: 'Morning report', prompt: 'Say what changed overnight.' }

const NOW = new Date('2026-02-01T00:00:00Z')

// -- what is refused, and under which name ----------------------------------

check(refusal({ ...BODY, kind: 'at', rule: { at: '2026-03-01T09:00:00' } }, {}, NOW) === 'invalid_rule',
  'a local wall-clock reading with no offset is not an instant and must be refused')
check(refusal({ ...BODY, kind: 'at', rule: { at: '2026-01-01T09:00:00Z' } }, {}, NOW) === 'not_future',
  'an instant in the past must be refused')
check(refusal({ ...BODY, kind: 'every', rule: { seconds: 60 } }, { minScheduleIntervalSeconds: 900 }, NOW) === 'frequency_too_high',
  'an interval under the account floor must be refused')
check(refusal({ ...BODY, kind: 'cron', rule: { expression: '* * * * *' } }, { minScheduleIntervalSeconds: 900 }, NOW) === 'frequency_too_high',
  'a cron rule whose tightest gap is under the floor must be refused')
check(refusal({ ...BODY, kind: 'cron', rule: { expression: '0 9 * * *' }, timeZone: 'Mars/Olympus' }, {}, NOW) === 'invalid_time_zone',
  'a zone this runtime does not know must be refused')
check(refusal({ ...BODY, prompt: '   ', kind: 'every', rule: { seconds: 3600 } }, {}, NOW) === 'invalid_prompt',
  'a prompt of whitespace must be refused')
check(refusal({ ...BODY, kind: 'sometimes', rule: {} }, {}, NOW) === 'invalid_kind',
  'a kind outside the closed set must be refused')

// -- an interval series is anchor-aligned -----------------------------------

const every = normalize({ ...BODY, kind: 'every', rule: { seconds: 3600 } }, {}, NOW)
check(every.nextRunAt.toISOString() === '2026-02-01T01:00:00.000Z',
  'the first occurrence of an hourly task is an hour after it was written')

const anchored = { kind: 'every', rule: { seconds: 3600, anchor: NOW.toISOString() } }
check(nextOccurrence(anchored, new Date('2026-02-01T05:30:00Z')).toISOString() === '2026-02-01T06:00:00.000Z',
  'an interval occurrence stays on the creation anchor rather than drifting to the last run')

// Six hours down, one occurrence back. Enumerating the gap would queue six
// runs to say the same thing once, which is the catch-up policy the harness's
// own scheduler settled on for the same reason.
check(nextOccurrence(anchored, new Date('2026-02-01T06:10:00Z')).toISOString() === '2026-02-01T07:00:00.000Z',
  'catching up after a long gap jumps to the next occurrence rather than replaying the missed ones')

// -- a calendar rule survives daylight saving -------------------------------
//
// New York moves to daylight time on 8 March 2026 and back on 1 November.
// Nine in the morning has to stay nine in the morning across both, which means
// the UTC instant is what moves — by exactly an hour, in opposite directions.

/**
 * The instant a cron rule next produces, in a zone.
 * @param {string} expression - the cron expression.
 * @param {string} timeZone - the IANA zone.
 * @param {string} after - the instant to search from.
 * @returns {string} the occurrence, as an ISO string.
 */
const occurrence = (expression, timeZone, after) =>
  nextOccurrence({ kind: 'cron', rule: { expression }, timeZone }, new Date(after)).toISOString()

check(occurrence('0 9 * * *', 'America/New_York', '2026-03-07T00:00:00Z') === '2026-03-07T14:00:00.000Z',
  'nine in the morning in New York is 14:00Z on standard time')
check(occurrence('0 9 * * *', 'America/New_York', '2026-03-09T00:00:00Z') === '2026-03-09T13:00:00.000Z',
  'nine in the morning in New York is 13:00Z on daylight time — the wall clock holds, the instant moves')
check(occurrence('0 9 * * *', 'America/New_York', '2026-10-31T00:00:00Z') === '2026-10-31T13:00:00.000Z',
  'nine in the morning in New York is 13:00Z before daylight time ends')
check(occurrence('0 9 * * *', 'America/New_York', '2026-11-02T00:00:00Z') === '2026-11-02T14:00:00.000Z',
  'nine in the morning in New York is 14:00Z after daylight time ends')

// A zone with no daylight saving at all, which is the one most of this
// deployment's tenants are in. It must not move.
check(occurrence('0 9 * * *', 'Asia/Shanghai', '2026-03-07T00:00:00Z') === '2026-03-07T01:00:00.000Z',
  'nine in the morning in Shanghai is 01:00Z in March')
check(occurrence('0 9 * * *', 'Asia/Shanghai', '2026-07-07T00:00:00Z') === '2026-07-07T01:00:00.000Z',
  'nine in the morning in Shanghai is 01:00Z in July too — that zone does not move')

// The weekday form, because it is what "every working day" means and the field
// is the one people most often write as 1-5 while meaning something else.
check(occurrence('0 9 * * 1-5', 'UTC', '2026-02-06T12:00:00Z') === '2026-02-09T09:00:00.000Z',
  'a weekday rule asked on a Friday afternoon answers with Monday')

// -- a one-shot is finished afterwards --------------------------------------

check(nextOccurrence({ kind: 'at', rule: { at: '2026-03-01T09:00:00Z' } }, new Date('2026-03-01T09:00:00Z')) === null,
  'a one-shot has no occurrence after the one it names')

if (problems.length > 0) {
  console.error('check-rules: a schedule does not mean what it says\n')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log('check-rules: intervals stay anchored and calendar rules hold their wall clock across daylight saving')
