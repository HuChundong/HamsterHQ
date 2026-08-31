/** Combo URLs that differ only in their query must never overwrite one another. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { assetPath, bootGraph, comboMap, moduleAssets, shellAssets } from '../web/shell-assets.mjs'

const id = '@deepseek-ai/dsh-client-connection'
const first = `/plugins/??${id}/client.js&rev=one`
const batch = `/plugins/??${id}/client.js,example/client.js&rev=two`
const map = first.replace('/client.js', '/client.js.map')
const graph = { entries: [{ id, url: first }], batches: [{ entries: [id, 'example'], url: batch }] }
const html = `<script>globalThis["__DSH_BOOT__"]=${JSON.stringify(graph)}</script>`
assert.deepEqual(bootGraph(html), graph)
assert.notEqual(assetPath(first), assetPath(batch))
assert.notEqual(assetPath(first), assetPath(map))
assert.equal(shellAssets(graph).length, 2)
assert.equal(moduleAssets(graph, id).length, 3)
assert.match(comboMap([first, batch, map]), /map \$request_uri \$dsh_combo_asset/)
for (const url of [first, batch, map]) assert.ok(comboMap([url]).includes(`"${url}" "${assetPath(url)}"`))
assert.throws(() => comboMap(['/plugins/??example/client.js&rev=$host']))
assert.throws(() => assetPath('/api/settings/describe'))

const shell = await mkdtemp(join(tmpdir(), 'check-dsh-shell-'))
try {
  await writeFile(join(shell, 'index.html'), html)
  const decision = 'isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),'
  for (const file of moduleAssets(graph, id)) {
    await mkdir(join(shell, file, '..'), { recursive: true })
    await writeFile(join(shell, file), decision)
  }
  const patch = new URL('../web/patch-loopback.mjs', import.meta.url).pathname
  assert.equal(spawnSync(process.execPath, [patch, shell]).status, 0)
  for (const file of moduleAssets(graph, id)) {
    assert.match(await readFile(join(shell, file), 'utf8'), /isLoopback: true \/\* HamsterHQ:/)
  }
  assert.notEqual(spawnSync(process.execPath, [patch, shell]).status, 0, 'a repeated patch must fail')
} finally {
  await rm(shell, { recursive: true, force: true })
}
console.log('check-shell-assets: combo queries remain distinct and every Connection copy is patched')
