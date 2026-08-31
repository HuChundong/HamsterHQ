/** Probe a Remote method through the published client; a 200 error is not success. */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { harnessRpc } from './harness-rpc.mjs'

const [jar, endpoint] = process.argv.slice(2)
const gateway = process.env.GATEWAY ?? 'http://localhost:8080'
const cookie = readFileSync(jar, 'utf8').split('\n')
  .filter((line) => line.startsWith('#HttpOnly_') || !line.startsWith('#'))
  .map((line) => line.split('\t')).filter((row) => row.length === 7)
  .map((row) => `${row[5]}=${row[6]}`).join('; ')
try {
  const rpc = await harnessRpc(gateway, cookie)
  const result = await rpc.call(endpoint, endpoint === 'credentials/describe' ? { refs: [] } : {})
  console.log(result.ok ? rpc.status() : `rpc-error:${result.error?.code ?? 'unknown'}`)
} catch {
  // Anonymous callers cannot load the gated client. Check API rejection too.
  const response = await fetch(`${gateway}/api/${endpoint}`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}', redirect: 'manual', signal: AbortSignal.timeout(120_000),
  })
  console.log(response.status === 401 ? 401 : `client-error:${response.status}`)
}
