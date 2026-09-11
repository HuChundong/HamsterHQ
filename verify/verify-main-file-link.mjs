/** Main-conversation produced files must open the envd-backed plugin. Spends model tokens using only the supplied acceptance tenant. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { harnessRpc } from './harness-rpc.mjs'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const UI_TIMEOUT = 15_000
const BOOT_TIMEOUT = 120_000
const TURN_TIMEOUT = 180_000
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
const filename = 'main-link-' + randomUUID() + '.md'
const path = '/mnt/workspace/' + filename
let fixture
let rpc
try {
  rpc = await harnessRpc(GATEWAY, cookie)
  const workspace = await rpc.call('workspace/create', { request: { path: '/mnt/workspace' } })
  assert(workspace.ok)
  const created = await rpc.call('session/create', {
    request: { workspaceId: workspace.value.workspace.workspaceId },
  })
  assert(created.ok)
  fixture = created.value.sessionId
  const title = 'File link acceptance ' + randomUUID()

  const prompted = await rpc.call('session/prompt', {
    request: {
      sessionId: fixture,
      requestId: randomUUID(),
      mode: 'queue',
      content: [
        {
          type: 'text',
          text:
            'For this acceptance test use your file editing tool to write exactly # MAIN_LINK_RESTORED followed by a newline to ' +
            path +
            '. Then present that file to the user and reply with its absolute path. Do not ask questions.',
        },
      ],
    },
  })
  assert(prompted.ok)
  await rpc.call('session/rename', { request: { sessionId: fixture, title } })
  await page.goto(GATEWAY + '/app')
  await page.getByText(title, { exact: true }).click({ timeout: BOOT_TIMEOUT })
  await page
    .locator(
      '[data-produced-files-row] button[title="' +
        path +
        '"], [data-presented-file] button[title="' +
        path +
        '"]',
    )
    .first()
    .click({ timeout: TURN_TIMEOUT })
  await page
    .locator('[data-workspace-preview]')
    .getByRole('heading', { name: 'MAIN_LINK_RESTORED' })
    .waitFor()
  assert(
    await page.locator('[data-workspace-files]:visible [role=treeitem][title="' + path + '"]').isVisible(),
  )
  console.log('PASS main-conversation file link opens owned envd-backed preview and tree')
} finally {
  await context.request.post(GATEWAY + '/sandbox/fs/remove', { data: { path } }).catch(() => {})
  if (fixture) await rpc.call('workspace/archiveSession', { request: { sessionId: fixture } }).catch(() => {})
  await browser.close()
}
