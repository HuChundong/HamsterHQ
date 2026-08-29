#!/usr/bin/env node
/**
 * Tiny readiness probe for CubeSandbox template create-from-image.
 *
 * Answers GET /health with 200 only when noVNC (:6080) and CDP (:9222) both
 * accept a TCP connect. Used solely during template build (--probe 6099);
 * tenant sandboxes do not need it after restore.
 */
import http from 'node:http'
import net from 'node:net'

const PORT = Number(process.env.DESKTOP_HEALTH_PORT ?? 6099)

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

const server = http.createServer(async (_req, res) => {
  const [novnc, cdp] = await Promise.all([listening(6080), listening(9222)])
  if (novnc && cdp) {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok\n')
    return
  }
  res.writeHead(503, { 'Content-Type': 'text/plain' })
  res.end(`not ready novnc=${novnc} cdp=${cdp}\n`)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`desktop-health: listening on :${PORT}`)
})
