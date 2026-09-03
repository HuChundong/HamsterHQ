/**
 * Pure values for the computer user-action handoff.
 *
 * Kept out of the Cordis plugin so the tree-side check can exercise the answer
 * and deferred-context contract without installing a second copy of DSH.
 *
 * @module dsh-computer/actions
 */

import { randomUUID } from 'node:crypto'

export const QUESTION_PREFIX = 'dsh-computer:user-action:'
export const ACTION_COMPLETED = 'completed'
export const ACTION_SKIPPED = 'skipped'

/**
 * Interpret the answer to one action request.
 *
 * An empty selection is the official generic question UI's Skip gesture. The
 * custom card has its own explicit Skip button, but keeping the generic
 * fallback equivalent means a missing client half cannot strand the tool.
 *
 * @param {object} answer - the user-questions answer batch.
 * @param {string} questionId - the exact question this call owns.
 * @returns {'completed'|'skipped'} the action outcome.
 */
export function actionStatus(answer, questionId) {
  const item = answer?.answers?.find?.((entry) => entry?.id === questionId)
  const selected = Array.isArray(item?.selected) ? item.selected : []
  if (selected.includes(ACTION_COMPLETED)) return ACTION_COMPLETED
  if (selected.includes(ACTION_SKIPPED) || selected.length === 0) return ACTION_SKIPPED
  throw new Error('the computer action answer was not one of the offered choices')
}

/**
 * Context injected after the wait, without manufacturing words in the visible
 * composer. The model needs the outcome and the original action together: a
 * bare "done" after a long human pause is ambiguous once several tools have
 * appeared in the turn.
 *
 * @param {'completed'|'skipped'} status - the action outcome.
 * @param {string} title - the action the user saw.
 * @returns {object} a frozen DSH UserMessage.
 */
export function deferredActionMessage(status, title) {
  const completed = status === ACTION_COMPLETED
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({
      type: 'text',
      text: completed
        ? `The user completed the requested computer action: ${title}. Continue from the browser's current state.`
        : `The user skipped the requested computer action: ${title}. Continue without waiting for it, or explain what cannot proceed.`,
    })]),
    source: Object.freeze({
      kind: 'plugin',
      plugin: 'computer',
      form: 'notice',
      summary: completed ? 'Computer action completed' : 'Computer action skipped',
    }),
  })
}
