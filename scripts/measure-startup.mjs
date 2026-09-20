/** Measure DSH process start to first tunnel dial in disposable image containers.
 * No tenant files, model calls or production gateway are involved.
 * SANDBOX_IMAGE selects the image; STARTUP_PATCH optionally selects a baseline
 * Cordis composition. Requires built images and a local Docker daemon.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
const image = process.env.SANDBOX_IMAGE ?? 'hamsterhq-sandbox:latest'
const runs = Number(process.env.STARTUP_RUNS ?? 3)
const TIMEOUT_MS = 60_000
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('STARTUP_RUNS must be 1–20')
const dir = mkdtempSync(join(tmpdir(), 'dsh-startup-'))
// A refused local handshake proves the published tunnel reached its dial step.
// Do not profile the short-lived migration process or keep it alive with timers.
writeFileSync(join(dir, 'probe.mjs'), `
import http from 'node:http';
if (process.argv[1]?.endsWith('/@deepseek-ai/dsh/lib/bin.js')) {
  const started = performance.now();
  const server = http.createServer();
  server.on('upgrade', (_req, socket) => {
    console.log('DSH_STARTUP_MS=' + Math.round(performance.now() - started));
    socket.end('HTTP/1.1 401 Unauthorized\\r\\nContent-Length: 0\\r\\n\\r\\n');
    process.exit(0);
  });
  server.listen(9999, '127.0.0.1');
  server.unref();
  setTimeout(() => process.exit(1), 30000).unref();
}
`)
const results = []
try {
  for (let run = 0; run < runs; run++) {
    const name = `dsh-startup-${randomUUID()}`
    const args = ['run', '--name', name, '--rm', '--network', 'none',
      '--entrypoint', '/app/sandbox/entrypoint.sh',
      '-e', 'NODE_OPTIONS=--import=/tmp/startup-probe.mjs',
      '-e', 'GATEWAY_TUNNEL_URL=ws://127.0.0.1:9999',
      '-e', 'SANDBOX_ID=startup-measurement', '-e', 'SANDBOX_TOKEN=local-only',
      '-v', `${dir}/probe.mjs:/tmp/startup-probe.mjs:ro`]
    if (process.env.STARTUP_PATCH) args.push('-v', `${resolve(process.env.STARTUP_PATCH)}:/app/sandbox/cordis.patch.yml:ro`)
    try {
      const result = spawnSync('docker', [...args, image], { encoding: 'utf8', timeout: TIMEOUT_MS })
      const output = result.stdout ?? ''
      const value = output.match(/^DSH_STARTUP_MS=(\d+)$/m)?.[1]
      if (result.status !== 0 || value === undefined) throw new Error(`Startup probe failed: ${result.error?.message ?? result.stderr}\n${output}`)
      results.push(Number(value))
    } finally {
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: TIMEOUT_MS })
    }
  }
  const sorted = [...results].sort((a, b) => a - b)
  console.log(JSON.stringify({ image, milliseconds: results, medianMs: sorted[Math.floor(sorted.length / 2)] }))
} finally {
  rmSync(dir, { recursive: true, force: true })
}
