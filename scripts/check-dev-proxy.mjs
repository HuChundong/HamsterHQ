/** Prove the development proxy streams replies without sharing its credential. */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { createModelProxy } from '../dev/model-proxy.mjs'
const secret = 'test-only-upstream-key'
let mode = 'stream'
let calls = 0
let release
let requestBody
const upstream = http.createServer(async (req, res) => {
  calls++
  assert.equal(req.headers.authorization, `Bearer ${secret}`)
  assert.equal(req.headers['x-untrusted'], undefined)
  assert.equal(req.url, '/vendor/v1/chat/completions')
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  requestBody = Buffer.concat(chunks).toString()
  if (mode === 'redirect') { res.writeHead(307, { Location: '/redirected' }).end(); return }
  if (mode === 'status') { res.writeHead(429, { 'Content-Type': 'application/json' }).end('{"error":"limited"}'); return }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.write('data: first\n\n')
  release = () => res.end('data: last\n\n')
})
upstream.listen(0, '127.0.0.1')
await once(upstream, 'listening')
const proxy = createModelProxy({ baseUrl: `http://127.0.0.1:${upstream.address().port}/vendor/v1`, apiKey: secret })
proxy.listen(0, '127.0.0.1')
await once(proxy, 'listening')
const origin = `http://127.0.0.1:${proxy.address().port}`
const options = { method: 'POST', headers: { Authorization: 'Bearer local-proxy-placeholder', 'X-Untrusted': 'must not forward' }, body: '{"stream":true}', signal: AbortSignal.timeout(5000) }
try {
  const response = await fetch(`${origin}/v1/chat/completions`, options)
  const reader = response.body.getReader()
  const first = await reader.read()
  assert.match(new TextDecoder().decode(first.value), /first/)
  assert.equal(first.done, false)
  assert.equal(requestBody, options.body)
  release()
  assert.match(new TextDecoder().decode((await reader.read()).value), /last/)
  mode = 'status'
  const limited = await fetch(`${origin}/v1/chat/completions`, options)
  assert.equal(limited.status, 429)
  assert.deepEqual(await limited.json(), { error: 'limited' })
  mode = 'redirect'
  const before = calls
  assert.equal((await fetch(`${origin}/v1/chat/completions`, options)).status, 502)
  assert.equal(calls, before + 1)
  for (const path of ['/v1/chat/completions?target=http://evil', '//evil/v1/models', '/v1/%2f%2fevil', '/v1/models/../../secrets']) {
    assert.equal((await fetch(origin + path, options)).status, 404)
  }
  const health = await fetch(`${origin}/health`)
  assert.equal(health.status, 200)
  assert.equal(await health.text(), 'ok')
  assert.equal((await fetch(`${origin}/v1/models`)).status, 401)
  assert.equal(calls, before + 1)
  console.log('check-dev-proxy: fixed upstream, replaced credential, streamed bytes, preserved status, redirects refused')
} finally {
  release?.()
  proxy.closeAllConnections(); upstream.closeAllConnections()
  proxy.close(); upstream.close()
}
