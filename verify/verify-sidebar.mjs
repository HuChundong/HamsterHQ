/**
 * Global navigation must work before a conversation exists, while Settings,
 * account menu and sandbox status stay at the foot in both sidebar widths. A source
 * check cannot prove the shell placed these registrations or mounted a page.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { COMPACT_HEADER } from '../packages/dsh-artifact-panel/src/constants.js'
import { harnessRpc } from './harness-rpc.mjs'
import { selectFixtureSession } from './select-fixture-session.mjs'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const BOOT_TIMEOUT = Number(process.env.VERIFY_SIDEBAR_TIMEOUT ?? 120_000)
const UI_TIMEOUT = 15_000
const cookie = process.env.TURN_COOKIE
if (!cookie) throw new Error('TURN_COOKIE must name an acceptance tenant session')
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
/** A one-page blank PDF with an exact cross-reference table, for PDF.js. */
function blankPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>',
  ]
  let result = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result))
    result += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(result)
  result += `xref\n0 4\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}`
  return Buffer.from(`${result}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
}

const errors = []
const fixturePaths = []
const fixtureSessions = []
let rpc
page.on('pageerror', (error) => errors.push(error.message))

/** Assert the account and sandbox remain below the global navigation. */
async function footerBelow(navigation, collapsed = false) {
  const top = await navigation.boundingBox()
  assert(top, 'global panel navigation is missing')
  const sandbox = collapsed ? '.dsh-sandbox-host-sandbox-compact' : '.dsh-sandbox-host-sandbox'
  for (const seat of [page.locator('.dsh-tenant-account-row'), page.locator(sandbox)]) {
    await seat.waitFor({ state: 'visible' })
    const box = await seat.boundingBox()
    assert(box.y > top.y + top.height, 'a bottom entry moved into global navigation')
    assert(box.y + box.height <= 1001, 'a bottom entry fell outside the viewport')
  }
}

/** The title, view tabs and actions fit the deployment's single-row header. */
async function compactHeader() {
  const header = page.locator('header:has(> [data-slot="conversation.session.header"])')
  await header.waitFor({ state: 'visible' })
  // The sidebar animates its width; measure after it has given the column
  // enough room, rather than measuring the old expanded width mid-transition.
  await page.waitForFunction(() => {
    const element = globalThis.document.querySelector('header:has(> [data-slot="conversation.session.header"])')
    return element?.getBoundingClientRect().width >= Math.min(globalThis.innerWidth - 70, 400)
  })
  const result = await header.evaluate((element, guard) => {
    const rect = element.getBoundingClientRect()
    const parts = [
      ...element.querySelectorAll(
        'nav, [data-conversation-tabs], [data-slot="conversation.session.header.utilities"] button, [data-conversation-header-corner] button',
      ),
    ]
      .map((part) => part.getBoundingClientRect())
      .filter((box) => box.width > 0)
    return {
      guardMatches: element.matches(guard),
      height: rect.height,
      rowHeight: Math.max(...parts.map(box => box.bottom)) - Math.min(...parts.map(box => box.y)),
      aligned: parts.every(
        (box) => Math.abs(box.y + box.height / 2 - (parts[0].y + parts[0].height / 2)) < 3,
      ),
      inside: parts.every((box) => box.x >= rect.x && box.right <= rect.right + 1),
      titleWidth: parts[0].width,
    }
  }, COMPACT_HEADER)
  assert(result.guardMatches && result.height < 60 && result.rowHeight < 40 && result.aligned,
    `the title, view tabs and actions must occupy one row: ${JSON.stringify(result)}`)
  assert(
    result.inside && result.titleWidth > 20,
    `header controls and title must fit the conversation column: ${JSON.stringify(result)}`,
  )
}

async function sandboxShortcut(selector, key) {
  const shortcut = page.locator(selector)
  if (key) {
    await shortcut.focus()
    await shortcut.press(key)
  } else await shortcut.click()
  const selected = page
    .locator('[role="dialog"] button[aria-current="true"]')
    .filter({ has: page.locator('[data-dsh-section="sandbox"]') })
  await selected.waitFor()
  await page.keyboard.press('Escape')
  await page.locator('[role="dialog"]').waitFor({ state: 'hidden' })
}

try {
  await page.goto(`${GATEWAY}/app`, { waitUntil: 'domcontentloaded' })
  if (new URL(page.url()).pathname === '/profile') {
    await page.locator('input[name="name"]').fill('Sidebar acceptance')
    await page.getByRole('button', { name: /^(Get started|Start|开始使用)$/ }).click()
  }
  assert(
    new URL(page.url()).pathname.startsWith('/app'),
    'acceptance cookie is expired or sign-in was redirected',
  )
  const computer = page.locator('.dsh-computer-nav')
  await computer.waitFor({ timeout: BOOT_TIMEOUT })
  const navigationRpc = await harnessRpc(GATEWAY, cookie)
  await selectFixtureSession(page, navigationRpc, BOOT_TIMEOUT)
  // Exercise the global-navigation path with no existing right tab. A prior
  // Browser tab would bypass this path and conceal a stale Session selector.
  const right = page.locator('[data-sidebar-right-panel]')
  if (!(await right.isVisible())) await page.getByRole('button', { name: /^(Open right sidebar|打开右侧边栏)$/ }).click()
  const closes = right.locator('[data-dockkit-tab-close]')
  while (await closes.count()) await closes.last().click()
  await computer.click()
  await page.locator('.dsh-computer-panel').waitFor()
  assert.equal(await page.locator('.dsh-computer-panel[data-maximised="true"]').count(), 0)
  await footerBelow(computer)
  await sandboxShortcut('.dsh-sandbox-host-sandbox')

  const response = await context.request.get(`${GATEWAY}/schedule/tasks`)
  if (response.status() !== 501) {
    assert.equal(response.status(), 200, 'the schedule endpoint must answer for this tenant')
    const scheduled = page.getByRole('button', { name: /^(Scheduled tasks|定时任务)$/ })
    await scheduled.click()
    await page.locator('.dsh-scheduled-tasks-panel').waitFor()
    assert(await scheduled.isVisible())
    assert.equal(await page.locator('.dsh-computer-panel').count(), 0)
    await page.getByRole('button', { name: /^(New task|新建任务)$/ }).click()
    await page.locator('.dsh-scheduled-tasks-form').waitFor()
    await page.getByRole('button', { name: /^(Back|返回)$/ }).click()
    await page.locator('.dsh-scheduled-tasks-form').waitFor({ state: 'detached' })
  } else assert.equal(await page.getByRole('button', { name: /^(Scheduled tasks|定时任务)$/ }).count(), 0)

  await computer.click()
  await page.getByRole('button', { name: /^(Collapse sidebar|收起侧边栏)$/ }).click()
  await footerBelow(computer, true)
  await sandboxShortcut('.dsh-sandbox-host-sandbox-compact', 'Enter')
  for (const key of ['Enter', 'Space']) {
    const account = page.getByRole('button', { name: /^(Account|账户)$/ })
    await account.focus()
    await account.press(key)
    await page.getByRole('menuitem', { name: /^(Settings|设置)$/ }).waitFor()
    await page.keyboard.press('Escape')
  }
  await page.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/ }).click()
  await footerBelow(computer)
  assert.equal(
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).count(),
    0,
    'Settings belongs in the account menu',
  )
  await page.locator('.dsh-tenant-account-row').click()
  await page.getByRole('menuitem', { name: /^(Settings|设置)$/ }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.dsh-tenant-account-row').click()
  await page.getByRole('menuitem', { name: /^(Sign out|Log out|退出登录)$/ }).waitFor()
  await page.keyboard.press('Escape')

  // Use the official Connection client for setup, then only visible controls
  // to select sessions and open tools. Two minimal prompts make the sessions
  // non-blank, since the shell deliberately hides unselected blank sessions.
  rpc = await harnessRpc(GATEWAY, cookie)
  const workspace = await rpc.call('workspace/create', { request: { path: '/mnt/workspace' } })
  assert.equal(workspace.ok, true)
  const suffix = process.env.VERIFY_SIDEBAR_REUSE ?? randomUUID().slice(0, 8)
  assert(/^[a-zA-Z0-9_-]+$/.test(suffix), 'VERIFY_SIDEBAR_REUSE must be a fixture suffix, not a path')
  const sessionTitles = [`Sidebar A ${suffix}`, `Sidebar B ${suffix}`]
  for (const title of process.env.VERIFY_SIDEBAR_REUSE ? [] : sessionTitles) {
    const created = await rpc.call('session/create', {
      request: { workspaceId: workspace.value.workspace.workspaceId },
    })
    assert.equal(created.ok, true, 'the host must create an acceptance session')
    fixtureSessions.push(created.value.sessionId)
    const prompted = await rpc.call('session/prompt', {
      request: {
        sessionId: created.value.sessionId,
        requestId: randomUUID(),
        mode: 'queue',
        content: [{ type: 'text', text: 'Reply with exactly OK. Do not use tools.' }],
      },
    })
    assert.equal(prompted.ok, true, 'the acceptance session must accept a minimal turn')
    const renamed = await rpc.call('session/rename', {
      request: { sessionId: created.value.sessionId, title },
    })
    assert.equal(renamed.ok, true)
  }
  const path = `/mnt/workspace/sidebar-${suffix}.md`
  const written = await context.request.post(`${GATEWAY}/sandbox/fs/write?path=${encodeURIComponent(path)}`, {
    data: `# Sidebar document ${suffix}\n\nOfficial document preview acceptance.\n`,
  })
  assert.equal(written.status(), 200)
  fixturePaths.push(path)
  const pdfPath = `/mnt/workspace/sidebar-${suffix}.pdf`
  const pdfWritten = await context.request.post(
    `${GATEWAY}/sandbox/fs/write?path=${encodeURIComponent(pdfPath)}`,
    { data: blankPdf() },
  )
  assert.equal(pdfWritten.status(), 200)
  fixturePaths.push(pdfPath)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText(sessionTitles[0], { exact: true }).click({ timeout: BOOT_TIMEOUT })
  for (const width of [1440, 720, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
        ),
    )
    if (width === 390) {
      const collapse = page.getByRole('button', { name: /^(Collapse sidebar|收起侧边栏)$/ })
      if (await collapse.isVisible()) await collapse.click()
      await page.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/ }).waitFor()
    }
    await compactHeader()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      ),
  )
  const expand = page.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/ })
  if (await expand.isVisible()) await expand.click()
  const headerTabs = page.locator('[data-slot="conversation.session.header"] [role="tab"]')
  await headerTabs.nth(1).click()
  assert.equal(await headerTabs.nth(1).getAttribute('aria-selected'), 'true')
  await headerTabs.nth(0).click()
  await page.getByRole('button', { name: /^(Open right sidebar|打开右侧边栏)$/ }).click()
  await compactHeader()
  await page.getByRole('button', { name: /^(Files|文件)$/i }).click()
  await page.locator('[data-dsh-artifact-panel][data-tool="files"]').waitFor()
  await page.getByText(`sidebar-${suffix}.md`, { exact: true }).click()
  await page.getByRole('heading', { name: `Sidebar document ${suffix}`, exact: true }).waitFor()

  await page.getByRole('tab', { name: /^(Files|文件)/i }).click()
  await page.getByText(`sidebar-${suffix}.pdf`, { exact: true }).click()
  await page.locator('iframe[title="' + `sidebar-${suffix}.pdf` + '"]').waitFor()

  await page
    .getByRole('button', { name: /^(New session|新建会话)$/ })
    .first()
    .click()
  // Upstream keeps navigation corners on blank sessions; only the previous
  // conversation's title, actions and view tabs disappear.
  const blankHeader = page.locator('header:has(> [data-slot="conversation.session.header"])')
  await blankHeader.waitFor({ state: 'visible' })
  await blankHeader.locator('nav').waitFor({ state: 'hidden' })
  await page.locator('[data-slot="conversation.session.header"]').getByRole('tablist').waitFor({ state: 'hidden' })
  for (const title of sessionTitles) assert.equal(await blankHeader.getByText(title, { exact: true }).count(), 0)
  const blankComposer = page.locator('[data-composer-input][contenteditable="true"]').first()
  await blankComposer.waitFor()
  assert.equal(await blankComposer.textContent(), '', 'a new conversation must start with an empty composer')
  assert.deepEqual(errors, [], 'sidebar navigation must not throw in the browser')
  console.log(
    'PASS: global pages, footer entries, compact header, official file preview work',
  )
} finally {
  // A failed screenshot or cleanup request must not leave the browser running
  // or prevent cleanup of the other fixtures created by this invocation.
  const cleanup = async (action) => {
    try {
      await action()
    } catch {
      console.error('fixture cleanup: request failed')
    }
  }
  try {
    if (process.env.SIDEBAR_SCREENSHOT)
      await cleanup(() => page.screenshot({ path: process.env.SIDEBAR_SCREENSHOT }))
    for (const path of fixturePaths) {
      await cleanup(async () => {
        const removed = await context.request.post(`${GATEWAY}/sandbox/fs/remove`, { data: { path } })
        if (removed.status() !== 200) console.error(`fixture cleanup: HTTP ${removed.status()}`)
      })
    }
    for (const sessionId of fixtureSessions) {
      await cleanup(async () => {
        const archived = await rpc.call('workspace/archiveSession', { request: { sessionId } })
        if (!archived.ok) console.error('fixture cleanup: session archive failed')
      })
    }
  } finally {
    await browser.close()
  }
}
