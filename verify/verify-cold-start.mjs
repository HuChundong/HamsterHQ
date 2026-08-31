/**
 * The first session call after a cold start must succeed without a retry.
 * An open Remote WebSocket only proves the carrier exists; its business
 * service can still be unavailable. Warm-session checks miss that interval.
 * Only the explicitly selected acceptance tenant's sandbox is restarted.
 */
import process from 'node:process'
import { signIn } from './verify-login.mjs'
import { harnessRpc } from './harness-rpc.mjs'

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const USER = process.env.COLD_START_USER ?? process.env.VERIFY_ALICE ?? 'delivered+alice@resend.dev'
const cookie = await signIn(GATEWAY, USER)
const rpc = await harnessRpc(GATEWAY, cookie)
const restarted = await fetch(`${GATEWAY}/sandbox/restart`, {
  method: 'POST', headers: { Cookie: cookie },
})
if (restarted.status !== 200) throw new Error(`sandbox restart: HTTP ${restarted.status}`)

// No readiness request, delay, or retry: this call is what starts the machine.
const catalog = await rpc.call('session/modelCatalog')
if (!catalog.ok) throw new Error(`first cold session call: ${JSON.stringify(catalog.error)}`)
const created = await rpc.call('session/create', { request: { cwd: '/mnt/workspace' } })
if (!created.ok) throw new Error(`cold session creation: ${JSON.stringify(created.error)}`)
console.log('PASS: the first cold session call and session creation succeed without retrying')
