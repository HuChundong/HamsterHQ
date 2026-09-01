/**
 * One generic file through the real composer's drop path.
 *
 * The upload RPC can succeed while the UI loses its mounting point: that is
 * exactly what the Dsh 0.1.2 textarea-to-Lexical migration exposed. This
 * drives the shipped browser, waits for the committed card rather than only
 * the file request, and removes it so no attachment notice reaches a later
 * model turn.
 */
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const CARD_TIMEOUT_MS = Number(process.env.ATTACHMENT_TIMEOUT_MS ?? 180_000)
const NAME = `attachment-card-${String(process.pid)}.txt`
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
  await page.goto(`${GATEWAY}/app`, { waitUntil: 'domcontentloaded' })

  const composer = page.locator('[data-composer-input][contenteditable="true"]').first()
  if (!await composer.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await page.getByRole('button', { name: /choose workspace/i }).first().click()
    await page.getByRole('button', { name: /^open$/i }).click()
  }
  await composer.waitFor({ state: 'visible', timeout: CARD_TIMEOUT_MS })

  await page.evaluate(({ name }) => {
    const transfer = new globalThis.DataTransfer()
    transfer.items.add(new globalThis.File(['attachment card acceptance'], name, { type: 'text/plain' }))
    for (const type of ['dragenter', 'dragover', 'drop']) {
      globalThis.document.dispatchEvent(new globalThis.DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }))
    }
  }, { name: NAME })

  const seat = page.locator('[data-dsh-sandbox-host="attachments"]').first()
  const cardName = seat.locator('.dsh-sandbox-host-name', { hasText: NAME }).first()
  await cardName.waitFor({ state: 'visible', timeout: CARD_TIMEOUT_MS })
  await page.waitForFunction(
    ({ selector, name }) => {
      const node = [...globalThis.document.querySelectorAll(selector)]
        .find((candidate) => candidate.textContent === name)
      return node instanceof globalThis.HTMLElement && node.title !== '' && node.title !== name
    },
    { selector: '[data-dsh-sandbox-host="attachments"] .dsh-sandbox-host-name', name: NAME },
    { timeout: CARD_TIMEOUT_MS },
  )

  const besideInput = await seat.evaluate((node) =>
    node.parentElement?.querySelector('[data-input-scroll]')?.previousElementSibling === node)
  if (!besideInput) throw new Error('the committed attachment card is outside the composer input rail')

  await seat.locator('button').first().click()
  await cardName.waitFor({ state: 'detached', timeout: 30_000 })
  console.log('PASS: a committed generic-file attachment card is visible in the real composer')
} finally {
  await browser.close()
}
