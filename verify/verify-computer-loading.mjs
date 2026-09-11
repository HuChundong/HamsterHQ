/**
 * The real desktop connects through the gateway and leaves its loading cover.
 *
 * Requires a desktop sandbox image, a running deployment and TURN_COOKIE
 * holding a disposable tenant session. This is deliberately stricter than
 * verify-computer: a 502 or 503 is not a desktop that a person can operate.
 * No model turn is needed. The failure check asks for a nonexistent WebSocket
 * endpoint; it does not stop the sandbox or interrupt another connection.
 */
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const COOKIES = process.env.TURN_COOKIE
const SCREENSHOT = process.env.COMPUTER_SCREENSHOT
const CONNECT_TIMEOUT_MS = 180_000
const UI_TIMEOUT_MS = 10_000

if (!COOKIES) throw new Error('verify-computer-loading: TURN_COOKIE is required')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} ${detail}`)
  if (!ok) failures += 1
}

const browser = await chromium.launch({ channel: process.env.VERIFY_BROWSER_CHANNEL })
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  })
  await context.addCookies(COOKIES.split(';').map((pair) => {
    const separator = pair.indexOf('=')
    return { name: pair.slice(0, separator).trim(), value: pair.slice(separator + 1), url: GATEWAY }
  }))
  const query = new URLSearchParams({
    autoconnect: 'true', resize: 'scale', reconnect: 'true',
    path: 'computer/websockify', theme: 'dark', bg: '#1d1d1d',
    title: '电脑', connecting: '正在连接电脑…',
  })
  const desktopUrl = `${GATEWAY}/computer/vnc.html?${query}`
  const page = await context.newPage()
  const pageErrors = []
  const sockets = []
  page.on('pageerror', (error) => { pageErrors.push(error.message) })
  page.on('websocket', (socket) => { sockets.push(socket.url()) })

  // Hold the real module fetch, so the first-paint assertion does not depend
  // on a slow machine. Everything after release uses the shipped noVNC code.
  let releaseModule
  const moduleGate = new Promise((resolve) => { releaseModule = resolve })
  await page.route('**/app/ui.js', async (route) => {
    await moduleGate
    await route.continue()
  })
  try {
    await page.goto(desktopUrl, { waitUntil: 'commit', timeout: CONNECT_TIMEOUT_MS })
    await page.locator('#hhq-loading').waitFor({ state: 'visible', timeout: CONNECT_TIMEOUT_MS })
    check('standalone shows a loading cover before its modules arrive', true)
    await page.waitForFunction(() => document.getElementById('hhq-loading-label')?.textContent === '正在连接电脑…', null, { timeout: UI_TIMEOUT_MS })
    check('the connecting label is localized while its modules are still loading', true)
  } finally {
    releaseModule()
  }
  await page.waitForFunction(() => document.documentElement.classList.contains('noVNC_connected'), null, { timeout: CONNECT_TIMEOUT_MS })
  await page.locator('#hhq-loading').waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS })
  const state = await page.evaluate(() => ({
    title: document.title,
    theme: document.documentElement.getAttribute('data-hhq-theme'),
    background: document.documentElement.style.getPropertyValue('--hamsterhq-novnc-bg'),
    width: document.querySelector('canvas')?.width,
    height: document.querySelector('canvas')?.height,
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
    label: document.getElementById('hhq-loading-label')?.textContent,
  }))
  check('a real framebuffer connects through the gateway tunnel', sockets.some((url) => url.includes('/computer/websockify')) && state.width > 0 && state.height > 0, `${state.width}×${state.height}`)
  check('standalone keeps the localized title and connecting label', state.title === '电脑' && state.label === '正在连接电脑…')
  check('standalone uses the requested dark ground', state.theme === 'dark' && state.background === '#1d1d1d')
  check('standalone uses the deployment favicon', state.favicon?.includes('hamsterhq') === true, state.favicon)
  if (state.favicon) {
    const icon = await context.request.get(new URL(state.favicon, desktopUrl).href)
    check('the favicon asset is served', icon.ok(), String(icon.status()))
  }
  await page.evaluate(() => { document.title = 'Desktop - noVNC' })
  await page.waitForFunction(() => document.title === '电脑', null, { timeout: UI_TIMEOUT_MS })
  check('the localized title survives a later noVNC title write', true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT })
  check('reduced motion stops the spinner animation', await page.locator('.hhq-spinner').evaluate((node) => getComputedStyle(node).animationName) === 'none')

  const shell = await context.newPage()
  shell.on('pageerror', (error) => { pageErrors.push(error.message) })
  let releaseFrame
  const frameGate = new Promise((resolve) => { releaseFrame = resolve })
  await shell.route('**/computer/vnc.html?*', async (route) => {
    await frameGate
    await route.continue()
  })
  try {
    await shell.goto(`${GATEWAY}/app`, { waitUntil: 'domcontentloaded', timeout: CONNECT_TIMEOUT_MS })
    await shell.getByRole('button', { name: /^(Cloud computer|云端电脑)$/ }).click({ timeout: CONNECT_TIMEOUT_MS })
    await shell.locator('.dsh-computer-frame-cover').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
    check('the shell panel covers an iframe before its document arrives', true)
  } finally {
    releaseFrame()
  }
  const iframe = shell.locator('.dsh-computer-frame')
  await iframe.waitFor({ timeout: CONNECT_TIMEOUT_MS })
  const frame = await (await iframe.elementHandle()).contentFrame()
  await frame.waitForFunction(() => document.documentElement.classList.contains('noVNC_connected'), null, { timeout: CONNECT_TIMEOUT_MS })
  await shell.locator('.dsh-computer-frame-cover').waitFor({ state: 'detached', timeout: UI_TIMEOUT_MS })
  check('the shell panel uncovers its connected framebuffer', true)
  const before = await frame.evaluate(() => ({ origin: performance.timeOrigin, url: location.href }))
  const wasDark = await shell.locator('body').evaluate((node) => node.hasAttribute('data-ds-dark-theme'))
  await shell.locator('.dsh-tenant-account-row').click()
  await shell.getByRole('menuitem', { name: /^(Settings|设置)$/ }).click()
  await shell.getByRole('button', { name: /^(General|通用|常规)$/ }).click()
  await shell.getByRole('button', { name: wasDark ? /^(Light|浅色)$/ : /^(Dark|深色)$/ }).click()
  const targetTheme = wasDark ? 'light' : 'dark'
  await frame.waitForFunction((theme) => document.documentElement.getAttribute('data-hhq-theme') === theme, targetTheme, { timeout: UI_TIMEOUT_MS })
  const after = await frame.evaluate(() => ({ origin: performance.timeOrigin, url: location.href }))
  check('a theme change repaints the desktop without reloading it', before.origin === after.origin && before.url === after.url)
  const newWindow = new URL(await shell.locator('.dsh-computer-panel-open').getAttribute('href'), GATEWAY)
  check('the new-window link follows the updated theme', newWindow.searchParams.get('theme') === targetTheme)
  await shell.keyboard.press('Escape')
  if (SCREENSHOT) await shell.screenshot({ path: SCREENSHOT.replace(/(\.[^.]+)?$/, '-panel$1') })
  await shell.close()

  // A real failed HTTP upgrade on a path that has no WebSocket endpoint.
  const failed = await context.newPage()
  const failedUrl = new URL(desktopUrl)
  failedUrl.searchParams.set('path', 'acceptance-no-websocket')
  await failed.goto(failedUrl.href, { waitUntil: 'domcontentloaded', timeout: CONNECT_TIMEOUT_MS })
  const error = failed.locator('#noVNC_status.noVNC_status_error.noVNC_open')
  try {
    await error.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
  } catch (error) {
    console.log('failed connection state:', await failed.evaluate(() => ({
      root: document.documentElement.className,
      status: document.getElementById('noVNC_status')?.outerHTML,
      dialog: document.getElementById('noVNC_connect_dlg')?.className,
    })))
    throw error
  }
  check('a failed connection exposes the error', await failed.locator('#hhq-loading').isHidden())
  await error.click()
  const retry = failed.locator('#noVNC_connect_button')
  await retry.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
  check('dismissing the error leaves the retry button visible', await failed.locator('#hhq-loading').isHidden())
  // The local 404 can arrive before another Playwright command. Observe the
  // real class transition in the browser instead of delaying the transport.
  await failed.evaluate(() => {
    globalThis.__retryCoverWasVisible = false
    new MutationObserver(() => {
      if (document.documentElement.classList.contains('noVNC_connecting')
        && getComputedStyle(document.getElementById('hhq-loading')).display !== 'none') {
        globalThis.__retryCoverWasVisible = true
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true })
  })
  await Promise.all([
    failed.waitForEvent('websocket', { timeout: UI_TIMEOUT_MS }),
    retry.click(),
  ])
  await failed.waitForFunction(() => globalThis.__retryCoverWasVisible, null, { timeout: UI_TIMEOUT_MS })
  check('retrying restores the loading cover', true)
  await failed.close()

  const direct = await context.newPage()
  await direct.goto(`${GATEWAY}/computer/vnc.html`, { waitUntil: 'domcontentloaded', timeout: CONNECT_TIMEOUT_MS })
  await direct.locator('#noVNC_connect_button').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
  const defaults = await direct.locator('#hhq-loading').evaluate((node) => ({
    ink: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
    title: document.title,
  }))
  check('a direct URL keeps a readable dark-ground fallback', defaults.ink === 'rgb(244, 244, 242)' && defaults.background === 'rgb(27, 27, 28)', `${defaults.ink} on ${defaults.background}`)
  check('a direct URL exposes Connect and the default title', defaults.title === 'Computer' && await direct.locator('#hhq-loading').isHidden())
  await direct.close()

  check('the connected desktop has no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '))
  await context.close()
} finally {
  await browser.close()
}
if (failures > 0) process.exitCode = 1
