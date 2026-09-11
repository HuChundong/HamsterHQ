/** Fixed-upstream local Docker model transport; only this process reads the key. */
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

/** Create the real proxy with an operator-owned target, also used by the gate. */
export function createModelProxy({ baseUrl, apiKey }) {
  if (typeof baseUrl !== 'string' || !baseUrl) throw new Error('Model proxy requires MODEL_BASE_URL')
  const base = new URL(baseUrl.replace(/\/$/, '') + '/')
  if (!apiKey || !['http:', 'https:'].includes(base.protocol))
    throw new Error('Model proxy requires a credential and HTTP(S) upstream')
  return http.createServer(async (req, res) => {
    const controller = new AbortController()
    const disconnected = () => {
      if (!res.writableEnded) controller.abort()
    }
    req.once('aborted', disconnected)
    res.once('close', disconnected)
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
        return
      }
      if (req.headers.authorization !== 'Bearer local-proxy-placeholder') {
        res.writeHead(401).end()
        return
      }
      // Exact request targets: absolute URLs, query overrides and encoded paths
      // cannot select an upstream host or expose another operator endpoint.
      const routes = { '/v1/models': 'GET', '/v1/chat/completions': 'POST', '/v1/responses': 'POST' }
      if (routes[req.url] !== req.method) {
        res.writeHead(404).end()
        return
      }
      const target = new URL(req.url.slice('/v1/'.length), base)
      const upstream = await fetch(target, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        ...(req.method === 'POST' ? { body: req, duplex: 'half' } : {}),
        redirect: 'error',
        signal: controller.signal,
      })
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      })
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res)
      else res.end()
    } catch {
      if (!res.destroyed) {
        if (!res.headersSent) res.writeHead(502)
        res.end('Model upstream unavailable')
      }
    } finally {
      req.off('aborted', disconnected)
      res.off('close', disconnected)
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = parseEnv(readFileSync('/run/model-source.env', 'utf8'))
  createModelProxy({ baseUrl: env.MODEL_BASE_URL, apiKey: env.MODEL_API_KEY }).listen(8098, '0.0.0.0', () =>
    console.log('Fixed-target development model proxy ready'),
  )
}
