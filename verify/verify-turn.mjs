/**
 * One real model turn through the browser, gateway, tunnel and sandbox.
 * A visible assistant reply received without reloading proves streaming works;
 * Playwright drives the official client rather than duplicating its mux wire.
 */
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import process from 'node:process'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const ANSWER = `READY_${randomUUID().slice(0, 8)}`
const PROMPT = `Reply with exactly ${ANSWER} and nothing else.`
const TURN_TIMEOUT_MS = 180_000
const cookie = process.env.TURN_COOKIE
if (!cookie) throw new Error('TURN_COOKIE must name an acceptance tenant session')
const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  await context.addCookies(cookie.split(';').map((part) => {
    const [name, ...value] = part.trim().split('=')
    return { name, value: value.join('='), url: GATEWAY }
  }))
  const page = await context.newPage()
  let frames = 0
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/api/remote.mux') {
      socket.on('framereceived', () => { frames += 1 })
    }
  })
  await page.goto(`${GATEWAY}/app`, { waitUntil: 'domcontentloaded' })
  const composer = page.locator('[data-composer-input][contenteditable="true"]').first()
  if (!await composer.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await page.getByRole('button', { name: /choose workspace/i }).first().click()
    await page.getByRole('button', { name: /^open$/i }).click()
  }
  await composer.waitFor({ state: 'visible', timeout: TURN_TIMEOUT_MS })
  const before = frames
  await composer.fill(PROMPT)
  await composer.press('Enter')
  await page.getByText(ANSWER, { exact: true }).first().waitFor({ state: 'visible', timeout: TURN_TIMEOUT_MS })
  if (frames <= before) throw new Error('the reply arrived without any Remote downlink frames')
  console.log('PASS: READY streamed into the real browser through gateway -> tunnel -> sandbox -> model')
} finally {
  await browser.close()
}
