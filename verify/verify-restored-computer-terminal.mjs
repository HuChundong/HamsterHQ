/** Computer alongside a conversation and its embedded schedule. Uses only the supplied acceptance tenant. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { harnessRpc } from './harness-rpc.mjs'
import { selectFixtureSession } from './select-fixture-session.mjs'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const UI_TIMEOUT = 15_000
const BOOT_TIMEOUT = 120_000
const DESKTOP_TIMEOUT = 60_000
const TASK_DELAY_MS = 24 * 60 * 60 * 1000
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
async function fixedDetailHeader(panel) {
  await page.setViewportSize({ width: 1440, height: 400 })
  const back = panel.getByRole('button', { name: 'Back', exact: true })
  const before = await back.boundingBox()
  const save = panel.getByRole('button', { name: 'Save', exact: true })
  const saveBefore = await save.boundingBox()
  const scrolled = await panel.locator('.dsh-scheduled-tasks-detail-body').evaluate((node) => {
    node.scrollTop = node.scrollHeight
    return node.scrollTop
  })
  assert(scrolled > 0, 'fixture must scroll its detail body')
  const after = await back.boundingBox()
  assert.equal(after.y, before.y, 'detail header must remain fixed while body scrolls')
  assert(await back.isVisible())
  assert.equal((await save.boundingBox()).y, saveBefore.y, 'save action must remain fixed')
  assert(await save.isVisible())
  await page.setViewportSize({ width: 1440, height: 1000 })
}
let releaseDesktop
const desktopGate = new Promise((resolve) => {
  releaseDesktop = resolve
})
await page.route('**/computer/vnc.html?*', async (route) => {
  await desktopGate
  await route.continue()
})
let scheduleFixture
let rpc
try {
  const createdTask = await context.request.post(GATEWAY + '/schedule/tasks', {
    data: {
      task: {
        title: 'Computer UI acceptance',
        prompt: 'UI fixture only.',
        kind: 'at',
        rule: { at: new Date(Date.now() + TASK_DELAY_MS).toISOString() },
      },
    },
  })
  const createdValue = await createdTask.json()
  assert(createdValue.ok)
  scheduleFixture = createdValue.task.id
  const disabled = await context.request.patch(GATEWAY + '/schedule/tasks/' + scheduleFixture, {
    data: { enabled: false },
  })
  assert.equal(disabled.status(), 200, 'fixture schedule must be disabled before UI tests')
  rpc = await harnessRpc(GATEWAY, cookie)
  await page.goto(GATEWAY + '/app')
  await selectFixtureSession(page, rpc, BOOT_TIMEOUT)
  await page
    .locator('.dsh-computer-nav')
    .first()
    .click()
  const newTab = page.getByRole('button', { name: /^(New tab|新建标签页|新标签页)$/ })
  async function tool(name) {
    const guide = page.locator('[data-sidebar-right-panel]').getByRole('button', { name })
    await page.locator('[data-sidebar-right-panel]').evaluate(async (node) => {
      await Promise.allSettled(node.getAnimations().map((animation) => animation.finished))
    })
    if (!(await guide.isVisible())) await newTab.first().click()
    await guide.click()
  }

  await page.locator('[data-tool="computer"], .dsh-computer-panel').last().waitFor()
  await page
    .locator('.dsh-computer-frame-cover')
    .getByText(/Connecting/)
    .waitFor()
  await page.locator('.dsh-sandbox-host-sandbox-state[data-status="running"]').waitFor()
  assert.equal(await page.locator('.dsh-sandbox-host-sandbox-state').innerText(), 'Running')
  releaseDesktop()
  await page.frameLocator('iframe.dsh-computer-frame').locator('canvas').waitFor({ timeout: DESKTOP_TIMEOUT })
  await page.locator('.dsh-computer-schedule').getByText('Scheduled tasks', { exact: true }).waitFor()
  assert(await page.getByRole('tab', { name: 'Chat', exact: true }).isVisible())
  const preview = page.locator('.dsh-computer-desktop-link')
  const launch = page.locator('.dsh-computer-launch')
  await page.mouse.move(300, 20)
  assert.equal(await launch.evaluate((node) => globalThis.getComputedStyle(node).opacity), '0')
  await preview.hover()
  await page.waitForFunction(
    () =>
      globalThis.getComputedStyle(globalThis.document.querySelector('.dsh-computer-launch')).opacity === '1',
  )
  const popupPromise = context.waitForEvent('page')
  await preview.click({ position: { x: 20, y: 20 } })
  const popup = await popupPromise
  await popup.waitForURL('**/computer/vnc.html?**')
  await popup.close()
  assert.equal(await page.locator('.dsh-computer-schedule .dsh-scheduled-tasks-what').count(), 0)
  await page.locator('.dsh-computer-schedule').getByText('Computer UI acceptance', { exact: true }).waitFor()
  const taskRow = page
    .locator('.dsh-computer-schedule .dsh-scheduled-tasks-item')
    .filter({ hasText: 'Computer UI acceptance' })
  await page.mouse.move(300, 20)
  const idleBackground = await taskRow.evaluate((node) => globalThis.getComputedStyle(node).backgroundColor)
  await taskRow.hover()
  const hoverBackground = await taskRow.evaluate((node) => globalThis.getComputedStyle(node).backgroundColor)
  assert.notEqual(hoverBackground, idleBackground, 'inline task row must visibly highlight on hover')
  assert.notEqual(hoverBackground, 'rgba(0, 0, 0, 0)', 'inline hover must not be transparent')
  console.log('PASS inline task hover highlights the entire row')
  await page.locator('.dsh-computer-schedule').getByRole('button', { name: 'New task', exact: true }).click()
  await page.locator('.dsh-computer-schedule .dsh-scheduled-tasks-form').waitFor()
  await page.locator('.dsh-computer-schedule').getByRole('button', { name: 'Back', exact: true }).click()
  const stableFrame = await page.locator('iframe.dsh-computer-frame').elementHandle()
  const stableBox = await preview.boundingBox()
  await page.locator('.dsh-computer-schedule .dsh-scheduled-tasks-item-body').click()
  await page.locator('.dsh-computer-schedule .dsh-scheduled-tasks-form').waitFor()
  assert(await stableFrame.evaluate((node) => node.isConnected), 'editing must retain the desktop frame')
  assert.deepEqual(await preview.boundingBox(), stableBox, 'editing must not resize the desktop')
  if (process.env.VERIFY_SCREENSHOT)
    await page.screenshot({ path: process.env.VERIFY_SCREENSHOT + '.detail.png' })
  await fixedDetailHeader(page.locator('.dsh-computer-schedule'))
  await page.locator('.dsh-computer-schedule').getByRole('button', { name: 'Back', exact: true }).click()
  assert(await stableFrame.evaluate((node) => node.isConnected), 'returning must retain the desktop frame')
  console.log('PASS desktop hover opens new window; compact schedule keeps add/edit controls')
  assert.equal(await page.locator('.dsh-computer-panel[data-maximised="true"]').count(), 0)
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click()
  await page.locator('.dsh-computer-panel[data-maximised="true"]').waitFor()
  await page.locator('.dsh-computer-schedule').waitFor({ state: 'hidden' })
  await preview.waitFor({ state: 'hidden' })
  const pageCount = context.pages().length
  await page
    .frameLocator('iframe.dsh-computer-frame')
    .locator('canvas')
    .click({ position: { x: 100, y: 100 } })
  assert.equal(context.pages().length, pageCount, 'fullscreen desktop must not launch a window')
  assert(
    await page
      .locator('iframe.dsh-computer-frame')
      .evaluate((node) => node.ownerDocument.activeElement === node),
    'fullscreen accepts direct focus',
  )
  if (process.env.VERIFY_SCREENSHOT)
    await page.screenshot({ path: process.env.VERIFY_SCREENSHOT + '.fullscreen.png' })
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
  await page.locator('.dsh-computer-schedule').waitFor()
  await preview.waitFor()
  console.log('PASS fullscreen hides tasks and directly accepts desktop interaction')
  const desktop = await page.locator('.dsh-computer-panel').boundingBox()
  const chat = await page.getByRole('tab', { name: 'Chat', exact: true }).boundingBox()
  assert(desktop && chat && desktop.x >= chat.x + chat.width - 2, 'computer stays in the right column')
  await page
    .locator('.dsh-computer-nav')
    .first()
    .click()
  await page.locator('.dsh-computer-panel').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.dsh-computer-panel').count(), 0, 'second click closes the computer tab instead of hiding the sidebar')
  await page
    .locator('.dsh-computer-nav')
    .first()
    .click()
  await page.locator('.dsh-computer-panel').waitFor()
  assert.equal(
    await page.locator('.dsh-computer-panel').count(),
    1,
    'repeated left navigation reuses the computer tab',
  )
  await page.frameLocator('iframe.dsh-computer-frame').locator('canvas').waitFor({ timeout: DESKTOP_TIMEOUT })
  await page.locator('.dsh-computer-frame-cover').waitFor({ state: 'hidden', timeout: DESKTOP_TIMEOUT })
  await tool(/^(Files|文件)$/)
  const files = page.locator('[data-workspace-files]')
  await files.waitFor()
  await page.locator('.dsh-computer-nav').click()
  await page.locator('.dsh-computer-panel').waitFor()
  await page.locator('.dsh-computer-nav').click()
  await page.locator('.dsh-computer-panel').waitFor({ state: 'detached' })
  await files.waitFor()
  assert(await page.locator('[data-sidebar-right-panel][data-sidebar-right-open]').isVisible(), 'closing computer preserves the sidebar containing Files')
  await page.locator('.dsh-computer-nav').dblclick()
  await page.locator('.dsh-computer-panel').waitFor({ state: 'detached' })
  await files.waitFor()
  console.log('PASS repeated computer navigation closes only its tab and preserves Files')
  await page.locator('.dsh-computer-nav').click()
  await page.locator('.dsh-computer-panel').waitFor()
  if (process.env.VERIFY_SCREENSHOT) await page.screenshot({ path: process.env.VERIFY_SCREENSHOT })
  const computerBox = await page.locator('.dsh-computer-nav').boundingBox()
  const scheduleBox = await page.locator('.dsh-scheduled-tasks-nav').boundingBox()
  const sandboxBox = await page.locator('.dsh-sandbox-host-sandbox').boundingBox()
  assert(
    computerBox.y > 600 &&
      scheduleBox.y >= computerBox.y + computerBox.height &&
      sandboxBox.y >= scheduleBox.y + scheduleBox.height,
    'bottom navigation order is Computer, Scheduled tasks, Sandbox',
  )
  await page.locator('.dsh-scheduled-tasks-nav').click()
  const globalSchedule = page.locator('.dsh-scheduled-tasks-panel[data-inline="false"]')
  await globalSchedule.waitFor()
  if (process.env.VERIFY_SCREENSHOT)
    await page.screenshot({ path: process.env.VERIFY_SCREENSHOT + '.schedule.png' })
  await globalSchedule.getByRole('button').filter({ hasText: 'Computer UI acceptance' }).click()
  await fixedDetailHeader(globalSchedule)
  // Reject only mutations of this invocation's task. Never route another
  // tenant fixture, and remove the handler before testing the successful save.
  const mutationUrl = `${GATEWAY}/schedule/tasks/${scheduleFixture}`
  const rejected = new Set()
  const rejectMutation = async (route) => {
    const method = route.request().method()
    if (['PATCH', 'DELETE'].includes(method) && !rejected.has(method)) {
      rejected.add(method)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, code: 'generic' }),
      })
    } else await route.continue()
  }
  await page.route(mutationUrl, rejectMutation)
  try {
    const enabled = globalSchedule.getByRole('switch')
    assert.equal(await enabled.getAttribute('aria-checked'), 'false')
    await enabled.click()
    await globalSchedule.getByRole('alert').waitFor()
    assert.equal(
      await enabled.getAttribute('aria-checked'),
      'false',
      'failed enable must preserve disabled state',
    )
    const remove = globalSchedule.getByRole('button', { name: 'Delete', exact: true })
    await remove.click()
    const deleted = page.waitForResponse(
      (response) => response.url() === mutationUrl && response.request().method() === 'DELETE',
    )
    await globalSchedule.locator('button[data-danger="true"]').click()
    assert.equal((await deleted).status(), 503)
    await page.waitForFunction(() => {
      const form = globalThis.document.querySelector('.dsh-scheduled-tasks-panel[data-inline="false"]')
      return (
        form?.querySelector('[role="alert"]') && !form.querySelector('button[data-danger="true"]')?.disabled
      )
    })
    assert(rejected.has('DELETE'), 'deletion request must reach the rejection fixture')
    assert(
      await globalSchedule.getByLabel('Name', { exact: true }).isVisible(),
      'failed delete must keep the editor open',
    )
    assert(await globalSchedule.getByRole('alert').isVisible(), 'failed delete must explain the error')
  } finally {
    await page.unroute(mutationUrl, rejectMutation)
  }
  await globalSchedule.getByLabel('Name', { exact: true }).fill('Computer UI saved')
  await globalSchedule.getByRole('button', { name: 'Save', exact: true }).click()
  await globalSchedule.getByText('Computer UI saved', { exact: true }).waitFor()
  await page.locator('.dsh-scheduled-tasks-nav').click()
  await globalSchedule.waitFor({ state: 'hidden' })
  assert(await page.getByRole('tab', { name: 'Chat', exact: true }).isVisible())
  console.log('PASS schedule detail saves and both footer entries toggle')
  console.log('PASS left Computer opens one right tab beside conversation with schedule')

} finally {
  releaseDesktop()
  if (scheduleFixture)
    await context.request.delete(GATEWAY + '/schedule/tasks/' + scheduleFixture).catch(() => {})
  await browser.close()
}
