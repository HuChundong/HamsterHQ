/**
 * Official generic-file intake through the real browser, including durable
 * bytes, tenant and Session receipt isolation, removal and one sent attachment.
 * Upload success alone cannot prove the composer or the model received a file.
 * Fixtures belong only to the supplied acceptance cookies; no sandbox is reset.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID, createHash } from 'node:crypto'
import { harnessRpc } from './harness-rpc.mjs'

const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const TIMEOUT = Number(process.env.ATTACHMENT_TIMEOUT_MS ?? 180_000)
const DSH_HOME = process.env.VERIFY_DSH_HOME ?? '/mnt/dsh'
const cookie = process.env.TURN_COOKIE
const bobCookie = process.env.ATTACHMENT_BOB_COOKIE
if (!cookie || !bobCookie) throw new Error('TURN_COOKIE and ATTACHMENT_BOB_COOKIE must name two acceptance tenants')
const browser = await chromium.launch({ args: ['--no-proxy-server'], channel: process.env.VERIFY_BROWSER_CHANNEL })
const context = await browser.newContext({ ignoreHTTPSErrors: true })
const cookies = value => value.split(';').filter(Boolean).map(part => {
  const [name, ...pieces] = part.trim().split('=')
  return { name, value: pieces.join('='), url: GATEWAY }
})
await context.addCookies(cookies(cookie))
const bobContext = await browser.newContext({ ignoreHTTPSErrors: true })
await bobContext.addCookies(cookies(bobCookie))
const page = await context.newPage()
page.setDefaultTimeout(TIMEOUT)
const sessions = new Set()
const errors = []
const bobProbe = `/mnt/workspace/attachment-isolation-${randomUUID()}.txt`
page.on('pageerror', error => errors.push(error.message))
let rpc

/** The published attachment-local provider stores immutable aliases by digest. */
function storedPath(file) {
  assert.match(file.attachmentId, /^sha256:[a-f0-9]{64}$/)
  assert(!file.name.includes('/') && !file.name.includes('\\'), 'the stored name is one path segment')
  const digest = file.attachmentId.slice(7)
  return `${DSH_HOME}/attachments/v1/files/${digest.slice(0, 2)}/${digest}/${file.name}`
}
const rawUrl = path => `${GATEWAY}/sandbox/raw/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
const composer = () => page.locator('[data-composer-input][contenteditable="true"]').first()
const card = name => page.locator('[data-composer-card]').locator('div[title]').filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.locator('button') }).first()

async function newSession() {
  await page.getByRole('button', { name: /^(New session|新建会话)$/ }).first().click()
  // New-session navigation mounts the composer asynchronously. Do not mistake
  // that transition for a missing workspace and open a second dialog.
  const ready = await composer().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, error => {
    if (error.name !== 'TimeoutError') throw error
    return false
  })
  if (!ready) {
    await page.getByRole('button', { name: /choose workspace|选择工作区/i }).first().click()
    await page.getByRole('button', { name: /^(Open|打开)$/ }).click()
  }
  await composer().waitFor({ state: 'visible' })
}

/** A real chooser or drop must travel on the official streamed-byte carrier. */
async function upload(name, body, intake) {
  // The official upload Worker terminates after completion. Capture its real
  // HTTP response before that destroys Playwright's response-body target.
  let resolveUpload
  let rejectUpload
  const pending = new Promise((resolve, reject) => { resolveUpload = resolve; rejectUpload = reject })
  const carrier = '**/api/session/uploadFileBinary?*'
  const capture = async route => {
    try {
      const response = await route.fetch({ timeout: TIMEOUT })
      const result = await response.json()
      await route.fulfill({ response })
      resolveUpload({ status: response.status(), url: route.request().url(), result })
    } catch (error) { rejectUpload(error); await route.abort().catch(() => {}) }
  }
  await context.route(carrier, capture)
  if (intake === 'chooser') {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: /^(Add files or run commands|添加文件或运行命令)$/ }).click()
    await page.getByRole('option', { name: /^(File|文件)$/ }).click()
    await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: body })
  } else {
    await page.evaluate(({ name, text }) => {
      const transfer = new globalThis.DataTransfer()
      transfer.items.add(new globalThis.File([text], name, { type: 'text/plain' }))
      for (const type of ['dragenter', 'dragover', 'drop']) {
        globalThis.document.dispatchEvent(new globalThis.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
      }
    }, { name, text: body.toString() })
  }
  console.log(`attachment: ${intake} intake submitted`)
  const response = await pending
  await context.unroute(carrier, capture)
  assert.equal(response.status, 200, 'the official upload carrier must be forwarded')
  const result = response.result
  assert.equal(result.ok, true, JSON.stringify(result.error))
  const sessionId = new URL(response.url).searchParams.get('sessionId')
  assert(sessionId, 'the upload must name its receiving Session')
  sessions.add(sessionId)
  assert.equal(result.value.file.bytes, body.length)
  assert.equal(result.value.file.attachmentId, `sha256:${createHash('sha256').update(body).digest('hex')}`)
  console.log(`attachment: ${intake} stored ${result.value.file.bytes} bytes`)
  await card(name).waitFor({ state: 'visible' })
  const bytes = await context.request.get(rawUrl(storedPath(result.value.file)))
  assert.equal(bytes.status(), 200, 'the uploaded file must exist on the tenant volume')
  assert.deepEqual(await bytes.body(), body, 'the stored file must contain every original byte')
  const foreign = await bobContext.request.get(rawUrl(storedPath(result.value.file)))
  assert([404, 502].includes(foreign.status()), 'the second tenant must not have the first tenant’s uploaded bytes')
  assert.equal((await foreign.json()).error?.code, 'file.unreadable', 'a cold or failed sandbox is not evidence of isolation')
  return { ...result.value, sessionId }
}

try {
  const bobPage = await bobContext.newPage()
  await bobPage.goto(`${GATEWAY}/app`, { waitUntil: 'domcontentloaded' })
  if (new URL(bobPage.url()).pathname === '/profile') {
    await bobPage.locator('input[name="name"]').fill('Attachment isolation acceptance')
    await bobPage.getByRole('button', { name: /^(Get started|Start|开始使用)$/ }).click()
  }
  await bobPage.getByRole('button', { name: /^(Cloud computer|云端电脑)$/ }).waitFor({ timeout: TIMEOUT })
  const probe = Buffer.from(randomUUID())
  const written = await bobContext.request.post(`${GATEWAY}/sandbox/fs/write?path=${encodeURIComponent(bobProbe)}`, { data: probe })
  assert.equal(written.status(), 200, 'the second tenant’s filesystem must be ready')
  const readable = await bobContext.request.get(rawUrl(bobProbe))
  assert.equal(readable.status(), 200)
  assert.deepEqual(await readable.body(), probe, 'isolation requires a working second tenant filesystem')
  await bobPage.close()
  await page.goto(`${GATEWAY}/app`, { waitUntil: 'domcontentloaded' })
  if (new URL(page.url()).pathname === '/profile') {
    await page.locator('input[name="name"]').fill('Attachment acceptance')
    await page.getByRole('button', { name: /^(Get started|Start|开始使用)$/ }).click()
  }
  await newSession()
  rpc = await harnessRpc(GATEWAY, cookie)
  const removedName = `removed-${randomUUID()}.txt`
  const removed = await upload(removedName, Buffer.from(`Removed attachment ${randomUUID()}\n`), 'chooser')
  assert.equal(await page.locator('[data-dsh-sandbox-host="attachments"], [data-dsh-sandbox-host="plus-upload"]').count(), 0,
    'the retired custom attachment portal must not mount beside the official UI')
  await card(removedName).locator('button').click()
  await card(removedName).waitFor({ state: 'detached' })

  // A receipt is scoped to the receiving Session, even inside the same tenant.
  const other = await rpc.call('session/create', { request: { cwd: '/mnt/workspace' } })
  assert.equal(other.ok, true)
  sessions.add(other.value.sessionId)
  const crossed = await rpc.call('session/prompt', { request: {
    sessionId: other.value.sessionId, requestId: randomUUID(), mode: 'queue',
    content: [{ type: 'file', receiptId: removed.receiptId }],
  } })
  assert.equal(crossed.ok, false, 'a receipt must not enter another Session')
  assert.equal(crossed.error?.code, 'session/attachment-invalid')

  assert.equal(await card(removedName).count(), 0, 'the removed file must no longer be pending')
  const sentName = `sent-${randomUUID()}.txt`
  const answer = `ATTACHMENT_${randomUUID().replaceAll('-', '')}`
  const sent = await upload(sentName, Buffer.from(`${answer}\n`), 'drop')
  assert.equal(sent.sessionId, removed.sessionId, 'removal must be tested against the same receiving Session')
  console.log('PASS: official chooser/drop, durable bytes, tenant and Session isolation, and removal')
  await composer().fill('Read the attached text file. Reply with only its exact text content, without Markdown or explanation.')
  await composer().press('Enter')
  await card(sentName).waitFor({ state: 'detached' })
  // A page ends at a real event cursor. -1 is the empty prefix, not latest.
  let serialized = ''
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const listed = await rpc.call('session/list', { _request: {} })
    assert.equal(listed.ok, true)
    const current = listed.value.items.find(item => item.sessionId === sent.sessionId)
    assert(current, 'the receiving Session must remain discoverable')
    const history = await rpc.call('session/page', { request: {
      address: { kind: 'session', sessionId: sent.sessionId }, throughSeq: current.projections.asOfSeq,
    } })
    assert.equal(history.ok, true)
    serialized = JSON.stringify(history.value)
    if (serialized.includes(sent.file.attachmentId)) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert(serialized.includes(sent.file.attachmentId), 'the sent message must retain its durable official file reference')
  assert(!serialized.includes(removed.file.attachmentId), 'removing a card must exclude that file from the sent turn')
  console.log('PASS: sent history retains the official file reference and excludes the removed file')
  let modelError
  try {
    await Promise.race([
      page.getByText(answer, { exact: true }).first().waitFor({ state: 'visible' }),
      page.getByText('This turn failed', { exact: true }).waitFor({ state: 'visible' }).then(() => {
        throw new Error('The browser reports This turn failed; inspect the model service error.')
      }),
    ])
  } catch (cause) {
    modelError = new Error('Official upload, removal and sending passed, but the model did not return the attached file content.', { cause })
    if (process.env.ATTACHMENT_SCREENSHOT) await page.screenshot({ path: process.env.ATTACHMENT_SCREENSHOT })
  }
  await newSession()
  assert.equal(await card(sentName).count(), 0, 'sent attachments must not follow into a fresh Session')
  console.log('PASS: a fresh Session has no attachment from the preceding turn')
  if (modelError) throw modelError
  assert.deepEqual(errors, [], 'upload, removal and sending must not throw in the browser')
  console.log('PASS: official chooser/drop, durable bytes, tenant and Session isolation, removal and a file-reading turn')
} finally {
  await bobContext.request.post(`${GATEWAY}/sandbox/fs/remove`, { data: { path: bobProbe } }).catch(() => {})
  for (const sessionId of sessions) {
    if (rpc) await rpc.call('workspace/archiveSession', { request: { sessionId } }).catch(error => console.error(`attachment fixture archive: ${error.message}`))
  }
  await browser.close()
}
