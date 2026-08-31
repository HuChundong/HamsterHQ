/** Domain-served settings must be written to the host and survive a fresh browser context. */
import { createRequire } from 'node:module'
import { lookup } from 'node:dns/promises'
import process from 'node:process'
import { harnessRpc } from './harness-rpc.mjs'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const cookie = process.env.TURN_COOKIE
if (!cookie) throw new Error('TURN_COOKIE must name an acceptance tenant session')
const origin = new URL(GATEWAY)
const args = ['--no-proxy-server']
if (origin.hostname === 'localhost' || origin.hostname.startsWith('127.') || origin.hostname === '[::1]') {
  const address = await lookup(origin.hostname === '[::1]' ? 'localhost' : origin.hostname, { family: 4 })
  origin.hostname = 'dsh-settings.invalid'
  args.push(`--host-resolver-rules=MAP dsh-settings.invalid ${address.address}`)
}
const browser = await chromium.launch({ args })
const rpc = await harnessRpc(GATEWAY, cookie)
const described = await rpc.call('settings/describe')
if (!described.ok) throw new Error('settings describe failed')
const original = described.value.namespaces.find((entry) => entry.ns === 'ui-theme')
if (!original) throw new Error('the host did not describe ui-theme')
const previous = original.user?.preference ?? 'system'
const target = previous === 'dark' ? 'light' : 'dark'

/** A fresh cookie-only context excludes localStorage as the source of persistence. */
async function openSettings() {
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  await context.addCookies(cookie.split(';').map((part) => {
    const [name, ...value] = part.trim().split('=')
    return { name, value: value.join('='), url: origin.href }
  }))
  const page = await context.newPage()
  await page.goto(`${origin.origin}/app`, { waitUntil: 'domcontentloaded' })
  await page.locator('.dsh-tenant-account-row').click({ timeout: 120_000 })
  await page.getByRole('menuitem', { name: /^(Settings|设置)$/ }).click()
  await page.getByRole('button', { name: /^(General|通用|常规)$/ }).click()
  return { context, page }
}

let restored
try {
  const first = await openSettings()
  const written = first.page.waitForResponse((response) =>
    response.url().includes('/api/settings/') && response.request().method() === 'POST'
      && /"ns":"ui-theme"/.test(response.request().postData() ?? ''), { timeout: 30_000 })
  await first.page.getByRole('button', { name: target === 'dark' ? /^(Dark|深色)$/ : /^(Light|浅色)$/ }).click()
  const reply = await (await written).json()
  if (reply.result?.ok !== true) throw new Error('the theme write was not accepted')
  await first.context.close()
  const second = await openSettings()
  const selected = second.page.getByRole('button', { name: target === 'dark' ? /^(Dark|深色)$/ : /^(Light|浅色)$/ })
  await selected.waitFor()
  if (await selected.getAttribute('aria-pressed') !== 'true') throw new Error('a new browser context lost the theme')
  await second.context.close()
  console.log('PASS: a domain browser persisted its theme on the host and a fresh context read it back')
} finally {
  restored = await rpc.call('settings/replace', { ns: 'ui-theme', section: original.user ?? {} })
  await browser.close()
}
if (!restored.ok) throw new Error('could not restore the original theme settings')
