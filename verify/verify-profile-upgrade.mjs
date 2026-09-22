/** Prove published DSH settings migrate and survive sandbox recreation.
 * This image-level Docker test uses its own volume, no deployment tenants,
 * credentials or model calls. VERIFY_PROFILE_FIXTURE_HOME may supply an old
 * settings.yaml only; session-history acceptance belongs to the live suite.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
const exec = promisify(execFile)
const IMAGE = process.env.VERIFY_PROFILE_IMAGE ?? 'hamsterhq-sandbox:latest'
const FIXTURE = process.env.VERIFY_PROFILE_FIXTURE_HOME
const TIMEOUT = Number(process.env.VERIFY_PROFILE_TIMEOUT_MS ?? 120000)
const token = `dsh-profile-verify-${Date.now()}`
const root = await mkdtemp(path.join(tmpdir(), `${token}-`))
const containers = []
/** Run Docker with bounded execution and captured output. */
async function docker(...args) { return (await exec('docker', args, { timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024 })).stdout.trim() }
const plugin = path.join(root, 'plugin')
await mkdir(plugin)
await writeFile(path.join(plugin, 'package.json'), JSON.stringify({ name: 'dsh-verify-profile-upgrade', version: '1.0.0', type: 'module', main: 'index.js' }))
await writeFile(path.join(plugin, 'index.js'), `
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
export const name = 'verify-profile-upgrade'
export const inject = ['settings']
export function apply(ctx) {
  setTimeout(async () => {
    try {
      await ctx.root.loader.await()
      const setting = ns => ctx.settings.describe().find(item => item.ns === ns)?.value
      const deadline = Date.now() + Number(process.env.VERIFY_PROFILE_TIMEOUT_MS ?? 120000)
      const expected = process.env.VERIFY_PHASE === 'write' ? 'dark' : 'light'
      const expectedModel = process.env.VERIFY_PHASE === 'write' ? 'deepseek-v4-flash' : 'persisted-model'
      while ((setting('ui-theme')?.preference !== expected || setting('agent-default-model')?.model !== expectedModel) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal(setting('ui-theme')?.preference, expected)
      if (process.env.VERIFY_PHASE === 'write') {
        assert.equal(setting('agent-default-model')?.model, 'deepseek-v4-flash')
        await ctx.settings.update('ui-theme', { preference: 'light' })
        await ctx.settings.update('agent-default-model', { provider: 'verification', model: 'persisted-model' })
      }
      assert.equal(setting('agent-default-model')?.model, 'persisted-model')
      assert.equal(setting('agent-default-model')?.provider, 'verification')
      assert.equal(setting('ui-theme')?.preference, 'light')
      const before = await readFile('/tmp/image-profile-before', 'utf8')
      const after = await readFile('/root/.dsh/profiles/web/cordis.patch.yml', 'utf8')
      assert.equal(after, before)
      await writeFile('/mnt/verification-result.json', JSON.stringify({ ok: true, phase: process.env.VERIFY_PHASE, documentPath: ctx.settings.documentPath }))
      process.exit(0)
    } catch (error) {
      await writeFile('/mnt/verification-result.json', JSON.stringify({ ok: false, message: error.message }))
      process.exit(1)
    }
  }, 0)
}
`)
const fixture = path.join(root, 'settings.yaml')
await writeFile(fixture, FIXTURE ? await readFile(path.join(FIXTURE, 'settings.yaml')) : 'ui-theme:\n  preference: dark\nagent-default-model:\n  provider: hamsterhq\n  model: deepseek-v4-flash\n')
try {
  await docker('volume', 'create', token)
  for (const phase of ['write', 'read']) {
    const name = `${token}-${phase}`
    containers.push(name)
    const command = `mkdir -p /mnt/dsh; cp /root/.dsh/profiles/web/cordis.patch.yml /tmp/image-profile-before; cat >> /app/sandbox/cordis.patch.yml <<'PATCH'\n- insert:\n    - id: verify-profile-upgrade\n      name: dsh-verify-profile-upgrade\nPATCH\n${phase === 'write' ? 'cp /tmp/verification-settings.yaml /mnt/dsh/settings.yaml; printf "2\\n" > /mnt/.dsh-layout; ln -s /root/.dsh/profiles /mnt/dsh/profiles;' : ''}\nexec /app/sandbox/entrypoint.sh`
    await docker('create', '--name', name, '--network', 'none', '--mount', `type=volume,src=${token},dst=/mnt`,
      '-e', `VERIFY_PHASE=${phase}`, '-e', `VERIFY_PROFILE_TIMEOUT_MS=${TIMEOUT}`,  '-e', 'MODEL_PROVIDER_ID=verification', '-e', 'MODEL_ID=deployment-default',
      '-e', 'MODEL_BASE_URL=http://127.0.0.1:9/v1', '-e', 'MODEL_API=openai-completions',
      '-e', 'MODEL_API_KEY=verification-placeholder', '-e', 'GATEWAY_TUNNEL_URL=ws://127.0.0.1:9',
      '-e', 'SANDBOX_ID=verification', '-e', 'SANDBOX_TOKEN=verification-placeholder',
      '--entrypoint', '/bin/bash', IMAGE, '-c', command)
    await docker('cp', `${plugin}/.`, `${name}:/root/.dsh/profiles/web/node_modules/dsh-verify-profile-upgrade`)
    await docker('cp', fixture, `${name}:/tmp/verification-settings.yaml`)
    await docker('start', name)
    const status = await docker('wait', name)
    const resultFile = path.join(root, `${phase}.json`)
    await docker('cp', `${name}:/mnt/verification-result.json`, resultFile)
    const result = JSON.parse(await readFile(resultFile, 'utf8'))
    assert.equal(result.ok, true, result.message ?? `container exit ${status}`)
    assert.equal(result.documentPath, '/mnt/dsh/profiles/web/cordis.patch.yml')
    console.log(`PASS profile upgrade ${phase}: settings API, persistent profile, immutable image patch`)
  }
} finally {
  for (const container of containers) await docker('rm', '-f', container).catch(() => {})
  await docker('volume', 'rm', token).catch(() => {})
  await rm(root, { recursive: true, force: true })
}
