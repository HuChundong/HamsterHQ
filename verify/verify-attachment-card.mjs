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
import { randomUUID } from 'node:crypto'
import process from 'node:process'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const CARD_TIMEOUT_MS = Number(process.env.ATTACHMENT_TIMEOUT_MS ?? 180_000)
// The workspace persists across acceptance runs. A container is PID 1 every
// time, so a PID name collides on the second run and the upload store gives the
// published file a different basename than the test keeps waiting for.
const NAME = `attachment-card-${randomUUID()}.txt`
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

  // The injected upload row is rendered through a portal, outside the trigger
  // menu's indexed candidates. Its pointer state must still look exactly like
  // a native row, without leaving the native keyboard highlight behind it.
  const launcher = page.locator('button[aria-haspopup="listbox"]').first()
  await launcher.click()
  const menu = page.locator('[role="listbox"]').first()
  const uploadOption = menu.locator('[data-dsh-sandbox-host="plus-upload"]').first()
  await uploadOption.waitFor({ state: 'visible' })
  await uploadOption.hover()
  const hover = await uploadOption.evaluate((node) => {
    const probe = globalThis.document.createElement('span')
    probe.style.background = 'var(--dsw-alias-interactive-bg-hover)'
    globalThis.document.body.append(probe)
    const expected = globalThis.getComputedStyle(probe).backgroundColor
    probe.remove()
    const transparent = 'rgba(0, 0, 0, 0)'
    const nativeBackgrounds = [...node.closest('[role="listbox"]')
      .querySelectorAll('[role="option"]:not([data-dsh-sandbox-host="plus-upload"])')]
      .map((option) => globalThis.getComputedStyle(option).backgroundColor)
    return {
      actual: globalThis.getComputedStyle(node).backgroundColor,
      expected,
      nativeClear: nativeBackgrounds.every((background) => background === transparent),
    }
  })
  if (hover.actual !== hover.expected) {
    throw new Error(`the upload option hover is ${hover.actual}, expected ${hover.expected}`)
  }
  if (!hover.nativeClear) throw new Error('a native option stays highlighted behind the upload option')
  await launcher.click()

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
