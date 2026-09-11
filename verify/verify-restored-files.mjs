/** File tree, owned preview, clipboard, refresh and deletion integration. Uses only the supplied acceptance tenant. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { harnessRpc } from './harness-rpc.mjs'
import { selectFixtureSession } from './select-fixture-session.mjs'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const UI_TIMEOUT = 15_000
const BOOT_TIMEOUT = 120_000
const REFRESH_TIMEOUT = 30_000
const cookie = process.env.TURN_COOKIE
if (!cookie) throw new Error('TURN_COOKIE must name an acceptance tenant')
const browser = await chromium.launch({
  args: ['--no-proxy-server'],
  channel: process.env.VERIFY_BROWSER_CHANNEL,
})
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } })
await context.addCookies(
  cookie
    .split(';')
    .filter(Boolean)
    .map((part) => {
      const [name, ...value] = part.trim().split('=')
      return { name, value: value.join('='), url: GATEWAY }
    }),
)
const page = await context.newPage()
page.setDefaultTimeout(UI_TIMEOUT)
let rpc
try {
  rpc = await harnessRpc(GATEWAY, cookie)
  await page.goto(GATEWAY + '/app')
  await selectFixtureSession(page, rpc, BOOT_TIMEOUT)
  const right = page.getByRole('button', { name: /^(Open right sidebar|打开右侧边栏)$/ })
  if (await right.isVisible()) await right.click()
  const newTab = page.getByRole('button', { name: /^(New tab|新建标签页|新标签页)$/ })
  async function tool(name) {
    const guide = page.locator('[data-sidebar-right-panel]').getByRole('button', { name })
    if (!(await guide.isVisible())) await newTab.first().click()
    await guide.click()
  }

  const folder = '/mnt/workspace/restoration-' + randomUUID()
  const path = folder + '/sample.md'
  const first = 'RESTORE_FIRST_' + randomUUID()
  const second = 'RESTORE_SECOND_' + randomUUID()
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  assert.equal(
    (await context.request.post(GATEWAY + '/sandbox/fs/mkdir', { data: { path: folder } })).status(),
    200,
  )
  async function write(value) {
    assert.equal(
      (
        await context.request.post(GATEWAY + '/sandbox/fs/write?path=' + encodeURIComponent(path), {
          data: value,
        })
      ).status(),
      200,
    )
  }
  const markdown =
    '# ' + first + '\n\n```js\nconst regression = 42;\n```\n\nA note[^1].\n\n[^1]: Markdown footnote.\n'
  try {
    await write(markdown)
    await tool(/^(Files|文件)$/)
    const tree = page.locator('[data-workspace-files]:visible')
    await tree
      .locator('[role=treeitem]')
      .filter({ hasText: folder.split('/').pop() })
      .click()
    const row = tree.locator('[role=treeitem][title="' + path + '"]')
    await row.click()
    const preview = page.locator('[data-workspace-preview]').filter({ hasText: first })
    await preview.waitFor()
    await preview.getByRole('button', { name: 'Copy', exact: true }).click()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'const regression = 42;')
    await tree.getByRole('button', { name: 'Source', exact: true }).click()
    await preview.getByText('const regression = 42;', { exact: false }).first().waitFor()
    await tree.getByRole('button', { name: 'Preview', exact: true }).click()
    await preview.getByRole('heading', { name: first, exact: true }).waitFor()
    assert(await tree.isVisible(), 'tree remains beside owned preview at default width')
    assert.equal(await row.getAttribute('aria-current'), 'true')
    await tree.getByRole('button', { name: 'Copy the path', exact: true }).click()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), path)
    await tree.getByRole('button', { name: 'Copy the contents', exact: true }).click()
    await page
      .getByText('Contents copied', { exact: true })
      .waitFor()
      .catch(() => {})
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), markdown)
    await write('# ' + second + '\n')
    await page
      .locator('[data-workspace-preview]')
      .filter({ hasText: second })
      .waitFor({ timeout: REFRESH_TIMEOUT })
    await tree.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.locator('[data-workspace-preview]').filter({ hasText: second }).waitFor()
    await page.getByRole('button', { name: 'Collapse right sidebar', exact: true }).click()
    await write('# HIDDEN_REFRESH_OK\n')
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
    await page
      .locator('[data-workspace-preview]')
      .filter({ hasText: 'HIDDEN_REFRESH_OK' })
      .waitFor({ timeout: REFRESH_TIMEOUT })
    console.log('PASS hidden preview refreshes on reveal')
    console.log('PASS directory companion, highlight, copy complete file/path, live refresh')
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Delete|^删除/ }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Delete|^删除/ })
      .click()
    await page.getByRole('tab', { name: /sample.md/ }).waitFor({ state: 'detached' })
    console.log('PASS deleting file closes its owned preview tab')
  } finally {
    try {
      const removed = await context.request.post(GATEWAY + '/sandbox/fs/remove', { data: { path: folder } })
      if (removed.status() !== 200)
        console.error(`fixture cleanup: directory removal HTTP ${removed.status()}`)
    } catch {
      console.error('fixture cleanup: directory removal failed')
    }
  }
} finally {
  await browser.close()
}
