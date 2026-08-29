#!/usr/bin/env node
/**
 * Tiny readiness probe for CubeSandbox template create-from-image.
 *
 * Answers GET /health with 200 only after the streamed desktop is visibly
 * ready, not merely after its sockets have opened. Used solely during template
 * build (--probe 6099); tenant sandboxes do not need it after restore.
 */
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import { promisify } from 'node:util'

const PORT = Number(process.env.DESKTOP_HEALTH_PORT ?? 6099)
const SETTLE_MS = Number(process.env.DESKTOP_HEALTH_SETTLE_MS ?? 5000)
const execFileAsync = promisify(execFile)
let readySince = 0

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => { resolve(false) })
  })
}

/**
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function processRunning(name) {
  try {
    await execFileAsync('pgrep', ['-u', 'desktop', '-x', name])
    return true
  } catch {
    return false
  }
}

/** @returns {Promise<boolean>} */
async function themeApplied() {
  try {
    await access('/home/desktop/.config/dsh-desktop/theme-state')
    return true
  } catch {
    return false
  }
}

/** @returns {Promise<boolean>} */
async function cdpHasPage() {
  try {
    const response = await fetch('http://127.0.0.1:9222/json/list', {
      signal: AbortSignal.timeout(1000),
    })
    if (!response.ok) return false
    const targets = await response.json()
    return Array.isArray(targets) && targets.some((target) => target?.type === 'page')
  } catch {
    return false
  }
}

const server = http.createServer(async (_req, res) => {
  const [vnc, novnc, cdp, plasma, kwin, theme] = await Promise.all([
    listening(5900),
    listening(6080),
    cdpHasPage(),
    processRunning('plasmashell'),
    processRunning('kwin_x11'),
    themeApplied(),
  ])
  const ready = vnc && novnc && cdp && plasma && kwin && theme
  if (!ready) readySince = 0
  else if (readySince === 0) readySince = Date.now()

  const settled = ready && Date.now() - readySince >= SETTLE_MS
  if (settled) {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok\n')
    return
  }
  res.writeHead(503, { 'Content-Type': 'text/plain' })
  res.end(
    `not ready vnc=${vnc} novnc=${novnc} cdp=${cdp} plasma=${plasma} `
    + `kwin=${kwin} theme=${theme} settled=${settled}\n`,
  )
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`desktop-health: listening on :${PORT}`)
})
