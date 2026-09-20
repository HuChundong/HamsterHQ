/** Persistent sidebar state, with controlled stats transport failures. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const gateway = process.env.GATEWAY ?? 'http://localhost:8080'
if (!process.env.TURN_COOKIE) throw new Error('TURN_COOKIE must name an acceptance tenant')
const browser = await chromium.launch({ args: ['--no-proxy-server'], channel: process.env.VERIFY_BROWSER_CHANNEL })
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1173, height: 863 } })
  await context.addCookies(process.env.TURN_COOKIE.split(';').filter(Boolean).map((part) => {
    const [name, ...value] = part.trim().split('=')
    return { name, value: value.join('='), url: gateway }
  }))
  const page = await context.newPage()
  // Prove the real gateway reading reaches the permanent second line first.
  await page.goto(gateway + '/app')
  const state = page.locator('.dsh-sandbox-host-sandbox-state')
  await page.locator('.dsh-sandbox-host-sandbox-state[data-status="running"]').waitFor({ timeout: 120_000 })
  assert(await state.isVisible())
  assert.match(await state.innerText(), /运行中|Running/)
  await page.reload()
  await page.locator('.dsh-sandbox-host-sandbox-state[data-status="running"]').waitFor({ timeout: 120_000 })
  // Control only this browser's stats stream; do not disturb a tenant's sandbox.
  await page.addInitScript(() => {
    const Native = globalThis.EventSource
    const streams = new Set()
    globalThis.EventSource = class extends EventTarget {
      static CLOSED = 2
      readyState = 0
      constructor(url, options) {
        super()
        if (url !== '/sandbox/stats') return new Native(url, options)
        streams.add(this)
      }
      close() { this.readyState = 2; streams.delete(this) }
    }
    globalThis.statusFixture = (ok) => {
      for (const stream of streams) {
        stream.readyState = ok === 'error' ? 0 : 1
        stream.dispatchEvent(ok === 'error'
          ? new Event('error')
          : new MessageEvent('message', { data: JSON.stringify({ ok }) }))
      }
    }
  })
  await page.reload()
  async function expectStatus(value) {
    await page.locator(`.dsh-sandbox-host-sandbox-state[data-status="${value}"]`).waitFor({ timeout: 15_000 })
    assert(await state.isVisible())
    assert((await state.innerText()).trim().length > 0)
  }
  await expectStatus('claiming')
  await page.evaluate(() => globalThis.statusFixture(false))
  await expectStatus('starting')
  await page.evaluate(() => globalThis.statusFixture(true))
  await expectStatus('running')
  await page.evaluate(() => globalThis.statusFixture('error'))
  await expectStatus('reconnecting')
  await page.evaluate(() => globalThis.statusFixture(true))
  await expectStatus('running')
  await page.evaluate(() => globalThis.statusFixture(false))
  await expectStatus('reconnecting')
  await page.evaluate(() => globalThis.statusFixture(true))
  await expectStatus('running')
  console.log('PASS persistent sandbox status, real connection and reload, startup, transport interruption, tunnel loss and reconnection')
} finally {
  await browser.close()
}
