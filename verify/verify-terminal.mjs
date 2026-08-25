/**
 * The terminal, opened at the moment it is worth having.
 *
 * A shell into the sandbox is the recovery page's answer to "why will my
 * backend not start", and the only thing that makes it an answer is that it
 * works while the backend does not. That is what this asserts: the caller's
 * machine is up with nothing serving on it, and a pty still starts and runs
 * what is typed into it.
 *
 * Run from inside the gateway container, which is where `ws` is installed and
 * where `/sandbox/pty` is one hop away.
 */

import process from 'node:process'
import WebSocket from 'ws'
import { signIn } from './verify-login.mjs'

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const USER = process.env.VERIFY_ALICE ?? 'delivered+alice@resend.dev'
/**
 * How long a shell is given to appear and answer.
 *
 * Generous because the first pty on a machine starts a shell, and a machine
 * whose backend just died is a machine nothing has warmed up.
 */
const SHELL_TIMEOUT_MS = 120_000

/** Distinct per run, so a frame left over from an earlier one cannot pass for this one's. */
const MARK = `dsh-terminal-${String(process.pid)}`

let passed = 0
let failed = 0

/**
 * Record one acceptance result.
 * @param {string} label - what was checked.
 * @param {boolean} ok - whether it held.
 * @param {string} detail - observed value.
 */
function check(label, ok, detail) {
  const mark = ok ? '[32mPASS[0m' : '[31mFAIL[0m'
  console.log(`  ${mark}  ${label.padEnd(46)} ${detail}`)
  if (ok) passed += 1
  else failed += 1
}

/**
 * Open a pty, type one command into it, and collect what comes back.
 *
 * @param {string} cookie - the session cookie header value.
 * @returns {Promise<{ready: boolean, echoed: boolean, detail: string}>} what the shell did.
 */
function runShell(cookie) {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${GATEWAY.replace('http', 'ws')}/sandbox/pty`, {
      headers: { Cookie: cookie },
    })
    let ready = false
    let output = ''
    let settled = false
    /**
     * Answer once, whatever ends the socket first.
     * @param {string} detail - what ended it.
     */
    const finish = (detail) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (socket.readyState === socket.OPEN) socket.close()
      resolve({ ready, echoed: output.includes(`${MARK}-said`), detail })
    }
    const timer = setTimeout(() => finish('timeout'), SHELL_TIMEOUT_MS)

    socket.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (message.type === 'ready') {
        ready = true
        // Base64, which is what the socket carries in both directions — sent
        // as plain text it is decoded as base64 anyway and reaches the shell
        // as bytes nobody typed.
        //
        // The marker is split in the command so that the shell echoing the
        // line back does not itself count as the shell having run it.
        const typed = Buffer.from(`echo ${MARK}"-said"\n`).toString('base64')
        socket.send(JSON.stringify({ type: 'in', data: typed }))
        return
      }
      if (message.type === 'out') {
        output += Buffer.from(message.data, 'base64').toString()
        if (output.includes(`${MARK}-said`)) finish('answered')
      }
    })
    socket.on('error', (error) => finish(error.message))
    socket.on('close', () => finish('closed'))
  })
}

const cookie = await signIn(GATEWAY, USER)
const shell = await runShell(cookie)

console.log('\n=== the terminal, with the backend down ===')
check('a pty starts on the live machine', shell.ready, shell.ready ? 'ready' : shell.detail)
check('and what is typed into it runs', shell.echoed, shell.detail)

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`)
process.exit(failed === 0 ? 0 : 1)
