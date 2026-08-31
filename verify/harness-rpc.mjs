/** Use the deployment's published Connection client instead of reproducing its RPC envelope. */
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'

/**
 * @param {string} gateway - the deployment origin.
 * @param {string} cookie - an acceptance tenant's gateway session.
 * @returns {Promise<{call: Function, status: Function}>} the official unary client.
 */
export async function harnessRpc(gateway, cookie) {
  const response = await fetch(`${gateway}/plugins/@deepseek-ai/dsh-client-connection/client.js`, {
    headers: { Cookie: cookie }, redirect: 'manual', signal: AbortSignal.timeout(30_000),
  })
  if (response.status !== 200) throw new Error(`Connection bundle: HTTP ${response.status}`)
  let entry
  let connection
  let status
  const realm = {
    URL, URLSearchParams, Headers, Request, Response, AbortController, AbortSignal,
    TextEncoder, TextDecoder, setTimeout, clearTimeout, console, crypto: webcrypto,
    location: new URL(gateway),
    window: { __ModuleLoader__: { load(value) { entry = value } } },
    __DSH_TRANSPORT__: {
      fetch: async (url, init) => {
        const headers = new Headers(init.headers)
        headers.set('Cookie', cookie)
        const result = await fetch(url, { ...init, headers })
        status = result.status
        return result
      },
    },
  }
  vm.runInNewContext(await response.text(), realm)
  if (entry?.id !== '@deepseek-ai/dsh-client-connection') throw new Error('wrong Connection bundle')
  const client = entry.factory((name) => { throw new Error(`unexpected Connection dependency: ${name}`) })
  client.apply({ provide(name, value) { if (name === 'connection') connection = value } })
  return {
    call: (endpoint, args = {}) => connection.rpc.call('/api', endpoint, { args }, AbortSignal.timeout(120_000)),
    status: () => status,
  }
}
