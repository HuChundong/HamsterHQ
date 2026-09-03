/**
 * The shared sandbox computer, host half.
 *
 * This owns the read-only browser plane and the one model-facing operation
 * that crosses from agent control to human control. The wait uses DSH's public
 * userQuestions service: it already scopes the request to the live root agent,
 * survives a pause without model tokens, and resumes the same tool call when a
 * browser client answers. No new wire protocol or harness patch is involved.
 *
 * The action tool exists only in the desktop image. A light sandbox still has
 * the browser preview channel, but offering a handoff where no interactive
 * desktop exists would turn a recoverable login page into an endless wait.
 *
 * @module dsh-computer
 */

import process from 'node:process'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ACTION_COMPLETED,
  ACTION_SKIPPED,
  QUESTION_PREFIX,
  actionStatus,
  deferredActionMessage,
} from './actions.js'
import * as browser from './browser.js'

export const name = 'computer'
export const inject = ['connection', 'webServer', 'tools', 'userQuestions']

const BROWSER_CHANNEL = '/browser'

const badRequest = (message) => ({ ok: false, error: { code: 'bad-request', message, details: { issues: [] } } })
const internal = (message) => ({ ok: false, error: { code: 'internal', message, details: {} } })

/** @param {unknown} value - model argument. @param {number} limit - display bound. @returns {string} text. */
const bounded = (value, limit) => String(value ?? '').trim().slice(0, limit)

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  ctx.connection.rpc.handle(BROWSER_CHANNEL, async (endpoint, payload) => {
    try {
      const body = payload ?? {}
      switch (endpoint) {
        case 'status':
          return { ok: true, value: await browser.status() }
        case 'shot': {
          const frame = await browser.shot(body.id === undefined ? undefined : String(body.id))
          if (frame === undefined) return badRequest('no such page')
          return { ok: true, value: frame }
        }
        default:
          return badRequest(`no such endpoint: ${endpoint}`)
      }
    } catch (error) {
      ctx.logger?.warn?.(`computer: browser ${endpoint} failed: ${error.message}`)
      return internal(error.message)
    }
  })

  if (process.env.SANDBOX_VARIANT !== 'desktop') {
    ctx.logger?.info?.('computer: no interactive desktop; user-action handoff tool is unavailable')
    return
  }

  ctx.tools.register(defineTool({
    name: 'computer_request_user_action',
    description: [
      'Pause this computer task when it cannot continue without a human operating the shared desktop.',
      'Use it for login, MFA, CAPTCHA, consent, or another action the user must perform in the browser.',
      'Do not ask the user to reveal a password, verification code, secret, or payment detail in chat.',
      'First navigate as far as automation safely can, then state one concrete action and wait once.',
      'The user can take over the Computer, mark the action completed, or skip it; execution resumes with that outcome.',
    ].join(' '),
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'A short, imperative title for the action card, such as "Sign in to X in the browser".',
      },
      instructions: {
        type: 'string',
        required: true,
        description: 'One or two sentences saying what to do and how the agent will know it can continue. Never request that a secret be pasted into chat.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: [ACTION_COMPLETED, ACTION_SKIPPED] },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === ACTION_COMPLETED
          ? 'The user completed the requested computer action.'
          : 'The user skipped the requested computer action.',
      }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('computer user action requires the live calling agent')
      const title = bounded(args.title, 120)
      const instructions = bounded(args.instructions, 800)
      if (title === '' || instructions === '') throw new Error('computer user action requires a title and instructions')

      const questionId = `${QUESTION_PREFIX}${exec.callId}`
      const answer = await ctx.userQuestions.ask({
        agent: exec.agent,
        signal: exec.signal,
        questions: [{
          id: questionId,
          header: 'Computer',
          question: title,
          detail: instructions,
          options: [
            { label: ACTION_COMPLETED, description: 'The requested action is finished; the agent may continue.' },
            { label: ACTION_SKIPPED, description: 'Do not wait for this action; continue without it.' },
          ],
        }],
      })
      const status = actionStatus(answer, questionId)
      exec.deferContext(deferredActionMessage(status, title))
      return { status }
    },
  }))
}
