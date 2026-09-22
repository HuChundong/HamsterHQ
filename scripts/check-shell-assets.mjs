/** Combo URLs that differ only in their query must never overwrite one another. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { assetPath, assetUrl, bootGraph, comboMap, lazyAssets, moduleAssets, shellAssets } from '../web/shell-assets.mjs'

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
const lazy = lazyAssets(graph.entries[0], 'require.async("./client.pdf.js"); require.async("./client.pdf.js"); require.async(\'./client.worker.js\'); require.async("another-package")')
assert.deepEqual(lazy, [`/plugins/${id}/client.pdf.js?rev=one`, `/plugins/${id}/client.worker.js?rev=one`])
assert.deepEqual(lazyAssets(graph.entries[0], 'require.async("./../client.bad.js")'), [])
assert.throws(() => lazyAssets({ id, url: batch }, 'require.async("./client.pdf.js")'))
assert.deepEqual(lazyAssets({ id: 'other', url: '/plugins/??other/client.js&rev=two' }, 'require.async("./client.pdf.js")'), ['/plugins/other/client.pdf.js?rev=two'])

// 0.1.7 publishes relative graph URLs and query-only combo source-map URLs.
// /app deliberately has no trailing slash; upstream's base href="./" keeps
// these requests under /plugins without editing the harvested document.
const relativeGraph = {
  entries: graph.entries.map((entry) => ({ ...entry, url: entry.url.slice(1) })),
  batches: graph.batches.map((entry) => ({ ...entry, url: entry.url.slice(1) })),
}
assert.deepEqual(moduleAssets(relativeGraph, id), moduleAssets(graph, id))
assert.equal(assetPath(first.slice(1)), assetPath(first))
assert.equal(assetUrl(map.slice('/plugins/'.length), first.slice(1)), map)
assert.equal(assetUrl('./client.pdf.js.map?rev=one', lazy[0]), `/plugins/${id}/client.pdf.js.map?rev=one`)
assert.equal(comboMap([first.slice(1), batch.slice(1), map.slice(1)]), comboMap([first, batch, map]))
assert.equal(comboMap([first, first.slice(1)]), comboMap([first]))
assert.deepEqual(lazyAssets(relativeGraph.entries[0], 'require.async("./client.pdf.js")'), [lazy[0]])
const documentBase = new URL('./', 'https://example.test/app')
assert.equal(new URL(relativeGraph.entries[0].url, documentBase).pathname, '/plugins/')
assert.equal(new URL(relativeGraph.entries[0].url, documentBase).search, new URL(first, documentBase).search)
assert.throws(() => assetUrl('https://another.test/plugins/??example/client.js'))
assert.throws(() => assetUrl('//another.test/plugins/??example/client.js'))
assert.throws(() => assetUrl('/plugins/example/client.js#fragment'))
// Keep the relative boot graph itself unchanged, including through the one
// sanctioned loopback patch; only harvest requests and disk mapping normalize.
const relativeHtml = `<head><base href="./"></head><script>globalThis["__DSH_BOOT__"]=${JSON.stringify(relativeGraph)}</script>`
assert.deepEqual(bootGraph(relativeHtml), relativeGraph)

const shell = await mkdtemp(join(tmpdir(), 'check-dsh-shell-'))
try {
  await writeFile(join(shell, 'index.html'), relativeHtml)
  const decision = 'isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),'
  for (const file of moduleAssets(graph, id)) {
    await mkdir(join(shell, file, '..'), { recursive: true })
    await writeFile(join(shell, file), decision)
  }
  const patch = new URL('../web/patch-loopback.mjs', import.meta.url).pathname
  assert.equal(spawnSync(process.execPath, [patch, shell]).status, 0)
  assert.equal(await readFile(join(shell, 'index.html'), 'utf8'), relativeHtml)
  for (const file of moduleAssets(graph, id)) {
    assert.match(await readFile(join(shell, file), 'utf8'), /isLoopback: true \/\* HamsterHQ:/)
  }
  assert.notEqual(spawnSync(process.execPath, [patch, shell]).status, 0, 'a repeated patch must fail')
} finally {
  await rm(shell, { recursive: true, force: true })
}
console.log('check-shell-assets: relative URLs and source maps resolve without changing the graph, combo queries remain distinct, and every Connection copy is patched')
