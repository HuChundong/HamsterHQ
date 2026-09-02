/**
 * Prove that browser file opens stop before the host-native opener.
 *
 * The generated session Remote exposes methods as getter descriptors. The old
 * implementation patched a removed Workspace Controller method, so every
 * tree-side check passed while a real click still reached xdg-open. This check
 * uses the generated namespace's descriptor shape and exercises both branches.
 *
 * Run: node scripts/check-panel-open.mjs
 */

import assert from 'node:assert/strict'
import { installPathOpen } from '../packages/dsh-artifact-panel/src/path-open.js'

const transportCalls = []
const nativeOpen = async (request) => {
  transportCalls.push(request)
  return { ok: false, error: { message: 'path open failed: spawn xdg-open ENOENT' } }
}

const sessionRemote = {}
const generatedGetter = () => nativeOpen
Object.defineProperty(sessionRemote, 'openWorkspacePath', {
  configurable: true,
  enumerable: true,
  get: generatedGetter,
})

const opened = []
const dispose = installPathOpen(sessionRemote, path => { opened.push(path) })

const intercepted = await sessionRemote.openWorkspacePath({ path: '/mnt/workspace/report.md' })
assert.deepEqual(intercepted, { ok: true, value: { opened: true } })
assert.deepEqual(opened, ['/mnt/workspace/report.md'])
assert.deepEqual(transportCalls, [])

const delegated = await sessionRemote.openWorkspacePath({ path: 'report.md' })
assert.equal(delegated.ok, false)
assert.deepEqual(transportCalls, [{ path: 'report.md' }])

dispose()
const restored = Object.getOwnPropertyDescriptor(sessionRemote, 'openWorkspacePath')
assert.equal(restored?.get, generatedGetter)
await sessionRemote.openWorkspacePath({ path: '/mnt/workspace/after-dispose.md' })
assert.deepEqual(transportCalls, [
  { path: 'report.md' },
  { path: '/mnt/workspace/after-dispose.md' },
])

console.log('check-panel-open: absolute paths open in the panel without reaching the native opener')
