/**
 * The computer handoff must pause on DSH's public question seam and answer the
 * exact call that produced the card. The visual side has three actions, while
 * only completed/skipped settle the wait; takeover opens the desktop and keeps
 * the tool pending.
 *
 * Run: node scripts/check-computer-action.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ACTION_COMPLETED,
  ACTION_SKIPPED,
  QUESTION_PREFIX,
  actionStatus,
  deferredActionMessage,
} from '../packages/dsh-computer/actions.js'

const root = resolve(import.meta.dirname, '..')
const host = readFileSync(resolve(root, 'packages/dsh-computer/index.js'), 'utf8')
const client = readFileSync(resolve(root, 'packages/dsh-computer/client.js'), 'utf8')

const questionId = `${QUESTION_PREFIX}call-1`
assert.equal(actionStatus({ answers: [{ id: questionId, selected: [ACTION_COMPLETED] }] }, questionId), ACTION_COMPLETED)
assert.equal(actionStatus({ answers: [{ id: questionId, selected: [ACTION_SKIPPED] }] }, questionId), ACTION_SKIPPED)
assert.equal(actionStatus({ answers: [{ id: questionId, selected: [] }] }, questionId), ACTION_SKIPPED)
assert.throws(
  () => actionStatus({ answers: [{ id: questionId, selected: ['something-else'] }] }, questionId),
  /not one of the offered choices/,
)

const notice = deferredActionMessage(ACTION_COMPLETED, 'Sign in')
assert.equal(Object.isFrozen(notice), true)
assert.equal(notice.role, 'user')
assert.equal(notice.source.kind, 'plugin')
assert.equal(notice.source.plugin, 'computer')
assert.match(notice.content[0].text, /Continue from the browser's current state/)

assert.match(host, /ctx\.userQuestions\.ask\(\{/)
assert.match(host, /agent: exec\.agent/)
assert.match(host, /signal: exec\.signal/)
assert.match(host, /exec\.deferContext\(deferredActionMessage\(status, title\)\)/)
assert.match(host, /process\.env\.SANDBOX_VARIANT !== 'desktop'/)

for (const label of ['card.takeover', 'card.done', 'card.skip']) assert.match(client, new RegExp(`t\\('${label}'\\)`))
assert.match(client, /window\.dispatchEvent\(event\)/)
assert.match(client, /owned\.pending\.answer\(\{/)
assert.match(client, /priority: -100/)
assert.match(client, /key: 'computer_request_user_action'/)
const takeover = client.slice(client.indexOf('const openComputer ='), client.indexOf('function ActionCard'))
assert.doesNotMatch(takeover, /\.answer\(/, 'Take over must keep the user-question wait pending')

console.log('check-computer-action: user handoff waits, settles and resumes through public seams')
