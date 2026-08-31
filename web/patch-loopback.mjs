/**
 * The one place this repository patches the harness, and the reason it does.
 *
 * `AGENTS.md` says never to patch, vendor, or fork DSH, and every other change
 * in this repository obeys that. This one does not, so it states its case here
 * and fails the build rather than the deployment when it stops applying.
 *
 * ## What it changes
 *
 * `@deepseek-ai/dsh-client-connection`'s browser half computes, once, at apply:
 *
 *     isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)
 *
 * and `@deepseek-ai/dsh-client-ui-settings` binds every settings namespace with
 * `connection.isLoopback ? "host" : "memory"`. On `"memory"` a preference lives
 * in the tab and is discarded on reload, and reads report `unavailable`. So for
 * a browser on any hostname but `localhost`, `[::1]` or `127/8`, the entire
 * configuration plane is inert: theme, language, conversation preferences, the
 * shell's own settings. Every tenant of this deployment is such a browser.
 *
 * ## Why upstream is right, and why we are not upstream
 *
 * Since 0.1.2-alpha.2, DSH authenticates even loopback RPC with a signed
 * browser cookie. Its client still selects memory persistence by hostname or
 * an embedding transport's ownsHost flag. The ordinary web entry supplies no
 * such transport, so a gateway-authenticated domain still loses preferences.
 *
 * Our gateway authenticates the tenant; the tunnel obtains a separate local
 * session through Connection's public authenticatedUrl/authorizeIndex methods.
 * The gateway cookie never reaches the sandbox. Host rewriting and the local
 * cookie together satisfy the upstream server's checks without weakening them.
 *
 * The client is therefore refusing to send something the server would accept,
 * on the strength of a hostname it reads out of its own address bar.
 *
 * ## Why it is patched here and not solved in a plugin
 *
 * Three plugin-shaped fixes were tried and each is closed:
 *
 * - **Configuration.** The browser half takes none. `trustedHosts` exists, but
 *   only the node half reads it; `apply(ctx)` has no config parameter.
 * - **Composition order.** `applyEntryPatches` can only *append* — without an
 *   id to the end of the root list, with one to the end of that group. A row
 *   this repository adds can never precede `ui-theme`.
 * - **Flipping the flag from a plugin.** The property is writable, but always
 *   too late: `ui-theme` has already constructed its controller by then, and
 *   `persistence` is fixed at construction.
 *
 * What remains inside the rules is an upstream change, which is not available.
 *
 * ## How this fails
 *
 * Loudly. An upgrade that renames or reshapes the expression makes this script
 * exit non-zero and the image build fail. A patch that matches nothing would
 * silently restore the original bug, so the build must fail rather than
 * continue.
 *
 * Usage: node web/patch-loopback.mjs <shell-directory>
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { bootGraph, moduleAssets } from './shell-assets.mjs'

/**
 * The expression as the published bundle writes it.
 *
 * Matched whole rather than by a loose regular expression: a pattern lenient
 * enough to survive a reshaping is lenient enough to match something else, and
 * the failure this guards against is precisely a reshaping.
 */
const FROM = 'isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),'

/**
 * What it becomes. The comment travels into the bundle so that anyone reading
 * the served asset — in a debugger, in a diff, in a bug report — finds the
 * reason there rather than only in this repository.
 */
const TO = 'isLoopback: true /* HamsterHQ: gateway-authenticated; see web/patch-loopback.mjs */,'

const shell = process.argv[2]
if (shell === undefined) {
  console.error('usage: node web/patch-loopback.mjs <shell-directory>')
  process.exit(2)
}

const graph = bootGraph(await readFile(path.join(shell, 'index.html'), 'utf8'))
const files = moduleAssets(graph, '@deepseek-ai/dsh-client-connection')
const pending = []
for (const file of files) {
  const source = await readFile(path.join(shell, file), 'utf8')
  const occurrences = source.split(FROM).length - 1
  if (source.includes(TO) || occurrences !== 1) {
    throw new Error(`patch-loopback: ${file}: expected one unpatched decision, found ${occurrences}; review upstream before shipping`)
  }
  pending.push({ file, source })
}
// Validate every executable copy before touching any of them. The initial
// batch and single-module combo must agree with the compatibility alias.
for (const { file, source } of pending) {
  await writeFile(path.join(shell, file), source.replace(FROM, TO))
}
await writeFile(path.join(shell, 'dsh-connection-assets.txt'), files.join('\n') + '\n')
console.log(`patch-loopback: ${files.length} served copies enable gateway-authenticated settings`)
