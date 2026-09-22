/**
 * Official Browser and Terminal must load through the gateway. Shell state must
 * survive refresh, and closing a terminal must terminate its shell, unlike the
 * removed workspace terminal. Uses only the supplied acceptance tenant.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { harnessRpc } from './harness-rpc.mjs'
import { selectFixtureSession } from './select-fixture-session.mjs'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const UI_TIMEOUT = 30_000
const BOOT_TIMEOUT = 120_000
const POLL_MS = 200
const cookie = process.env.TURN_COOKIE
if (!cookie) throw new Error('TURN_COOKIE must name an acceptance tenant')
const browser = await chromium.launch({ args: ['--no-proxy-server'], channel: process.env.VERIFY_BROWSER_CHANNEL })
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } })
await context.addCookies(cookie.split(';').filter(Boolean).map((part) => {
  const [name, ...value] = part.trim().split('=')
  return { name, value: value.join('='), url: GATEWAY }
}))
const page = await context.newPage()
page.setDefaultTimeout(UI_TIMEOUT)
const errors = []
const chunks = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('response', (response) => {
  if (response.url().includes('/client.terminal.js')) chunks.push(response.status())
})
const fixture = '/mnt/workspace/official-terminal-' + randomUUID()
async function openTool(kind) {
  // The panel root stays visible while its dock children slide offscreen.
  // Its explicit open state, rather than the root's box, owns visibility.
  const panel = page.locator('[data-sidebar-right-panel]:visible').last()
  if (await panel.getAttribute('data-sidebar-right-open') === null) {
    await page.getByRole('button', { name: /^(Open right sidebar|打开右侧边栏)$/ }).click()
  }
  const guide = panel.locator(`button[data-sidebar-right-guide-entry="${kind}"]:visible, [data-sidebar-right-guide-entry="${kind}"] button:visible`).first()
  if (!(await guide.isVisible())) await panel.getByRole('button', { name: /^(New tab|新标签页|新建标签页)$/ }).last().click()
  await guide.click()
}
async function command(value) {
  const terminal = page.locator('[data-sidebar-terminal]:visible').last()
  const input = terminal.locator('.xterm-helper-textarea')
  await input.waitFor()
  await terminal.getByRole('status').waitFor({ state: 'hidden' })
  await input.focus()
  await page.keyboard.insertText(value)
  await input.press('Enter')
}
async function readSuffix(suffix, expected) {
  const deadline = Date.now() + UI_TIMEOUT
  while (Date.now() < deadline) {
    const result = await context.request.get(GATEWAY + '/sandbox/raw/' + (fixture + suffix).split('/').filter(Boolean).map(encodeURIComponent).join('/'))
    if (result.ok()) {
      const value = await result.text()
      if (expected.test(value)) return value
    }
    await page.waitForTimeout(POLL_MS)
  }
  throw new Error('Missing shell result ' + suffix)
}
try {
  const rpc = await harnessRpc(GATEWAY, cookie)
  await page.goto(GATEWAY + '/app')
  await selectFixtureSession(page, rpc, BOOT_TIMEOUT)
  await openTool('browser')
  const address = page.getByPlaceholder(/^(Enter an HTTP\(S\) address|输入 HTTP\(S\) 地址)$/)
  await address.fill('https://official-browser.example.test/')
  await page.route('https://official-browser.example.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Official browser acceptance</h1>' }))
  await address.press('Enter')
  await page.frameLocator('iframe[src="https://official-browser.example.test/"]').getByRole('heading', { name: 'Official browser acceptance' }).waitFor()
  assert.equal(await page.locator('[data-dsh-artifact-panel][data-tool="browser"]').count(), 0)
  console.log('PASS official Browser navigates an HTTP page')
  await openTool('terminal')
  await command(`export DSH_OFFICIAL_CHECK=retained; printf '%s\\n' "$$" > ${fixture}.pid; printf 'ready\\n' > ${fixture}.ready`)
  await readSuffix('.ready', /^ready\s*$/)
  await command("printf 'OFFICIAL_%s\\n' OUTPUT_READY")
  await page.locator('.xterm-rows').filter({ hasText: 'OFFICIAL_OUTPUT_READY' }).waitFor()
  const pid = (await readSuffix('.pid', /^\d+\s*$/)).trim()
  assert(chunks.includes(200), 'official lazy terminal chunk must load successfully')
  assert.equal(await page.locator('[data-dsh-artifact-panel][data-tool="terminal"]').count(), 0)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.xterm-helper-textarea').waitFor({ timeout: BOOT_TIMEOUT })
  await page.locator('.xterm-rows').filter({ hasText: 'OFFICIAL_OUTPUT_READY' }).waitFor()
  await command(`printf '%s:%s\\n' "$$" "$DSH_OFFICIAL_CHECK" > ${fixture}.restored`)
  await readSuffix('.restored', new RegExp('^' + pid + ':retained\\s*$'))
  await command(`sleep 60; printf 'bad\\n' > ${fixture}.interrupted`)
  await page.locator('.xterm-helper-textarea').press('Control+c')
  await command(`printf '中文\\n' > ${fixture}.unicode`)
  await readSuffix('.unicode', /^中文\s*$/)
  await page.setViewportSize({ width: 1100, height: 800 })
  await command(`stty size > ${fixture}.size`)
  await readSuffix('.size', /^[1-9]\d* [1-9]\d*\s*$/)
  await page.getByRole('tab').filter({ has: page.locator('[data-dockkit-tab-close]') }).filter({ hasText: /Terminal|终端|bash|zsh|sh/ }).last().locator('[data-dockkit-tab-close]').click()
  await openTool('terminal')
  await command(`for attempt in $(seq 1 50); do kill -0 ${pid} 2>/dev/null || break; sleep 0.1; done; if kill -0 ${pid} 2>/dev/null; then printf 'alive\\n'; else printf 'closed\\n'; fi > ${fixture}.closed`)
  await readSuffix('.closed', /^closed\s*$/)
  await page.getByRole('tab').filter({ has: page.locator('[data-dockkit-tab-close]') }).filter({ hasText: /Terminal|终端|bash|zsh|sh/ }).last().locator('[data-dockkit-tab-close]').click()
  assert.deepEqual(errors, [], 'official tools must not throw in the browser')
  console.log('PASS official Terminal lazy load, input, Ctrl-C, resize, refresh retention and tab-close process cleanup')
} finally {
  for (const suffix of ['.pid', '.ready', '.restored', '.interrupted', '.unicode', '.size', '.closed']) {
    await context.request.post(GATEWAY + '/sandbox/fs/remove', { data: { path: fixture + suffix } }).catch(() => {})
  }
  await browser.close()
}
