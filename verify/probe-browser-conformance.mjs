/**
 * How much of what `playwright-cli` asks for the sandbox's browser answers.
 *
 * The browser in this image is not Chromium. Obscura is an independent engine
 * that speaks the Chrome DevTools Protocol, which is what lets Playwright's own
 * CLI drive it — but "speaks CDP" is the same kind of claim as "E2B
 * compatible", and this repository does not build on that word either. So the
 * commands the bundled skill tells an agent to use are run, one at a time,
 * against a page whose contents are known, and each is recorded as answering,
 * differing, or missing.
 *
 * Run it when the pinned Obscura version moves. What it prints is the list a
 * person decides about — not every divergence is worth blocking an upgrade,
 * and the ones that are should be named in docs rather than discovered by a
 * tenant.
 *
 * Hermetic on purpose. The fixture is served from inside the sandbox, so the
 * result says something about the browser rather than about the network that
 * day. That needs a second Obscura: the one the entrypoint starts refuses
 * private and loopback addresses — deliberately, since a browser an agent can
 * be talked into pointing at internal endpoints is how a sandbox becomes a
 * proxy into a deployment — so the probe starts its own with that fence
 * lowered, on its own port, and stops it when it is done.
 *
 * Usage, from inside a sandbox:
 *   node probe-browser-conformance.mjs
 *
 * Getting it there, from a host that can reach one:
 *   docker cp verify/probe-browser-conformance.mjs <sandbox>:/tmp/probe.mjs
 *   docker exec <sandbox> node /tmp/probe.mjs
 */

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

/** The port the probe's own browser listens on, beside the sandbox's own. */
const CDP_PORT = 9223
/** Where the fixture is served. */
const FIXTURE_PORT = 8899

/**
 * A page with one of everything the skill's commands name.
 *
 * Written out here rather than fetched: a probe that needs the internet
 * measures the internet.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>obscura-probe-fixture</title></head>
<body>
  <h1 id="title">obscura-probe-fixture</h1>
  <a id="link" href="/second.html">second page</a>
  <input id="text" type="text" aria-label="a text field">
  <textarea id="area" aria-label="an area"></textarea>
  <input id="box" type="checkbox" aria-label="a checkbox">
  <select id="pick" aria-label="a select">
    <option value="one">one</option>
    <option value="two">two</option>
  </select>
  <button id="press" onclick="document.getElementById('said').textContent = 'pressed'">press me</button>
  <p id="said">nothing</p>
  <div id="hoverable" onmouseover="document.getElementById('said').textContent = 'hovered'">hover me</div>
</body>
</html>`

const SECOND = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Second</title></head>
<body><h1>Second page</h1></body></html>`

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-probe-'))
fs.mkdirSync(path.join(work, '.playwright'), { recursive: true })
fs.writeFileSync(
  path.join(work, '.playwright', 'cli.config.json'),
  JSON.stringify({ browser: { cdpEndpoint: `http://127.0.0.1:${String(CDP_PORT)}` } }),
)

// A separate process, and that is not a style choice. Every command below is
// run with `spawnSync`, which blocks this event loop until the command
// returns — so a server written here would be deaf for exactly as long as the
// browser was asking it for the page. The first version was, and every command
// after `open` measured a blank page.
const pages = path.join(work, 'fixture')
fs.mkdirSync(pages, { recursive: true })
fs.writeFileSync(path.join(pages, 'index.html'), FIXTURE)
fs.writeFileSync(path.join(pages, 'second.html'), SECOND)
const fixture = spawn('python3', ['-m', 'http.server', String(FIXTURE_PORT), '--bind', '127.0.0.1'], {
  cwd: pages,
  stdio: 'ignore',
  detached: true,
})

// Both ports are checked before anything is started. A port that is already
// answering belongs to something else — a leftover from an interrupted run,
// the sandbox's own browser if somebody moved it here — and every measurement
// after that would be of the wrong browser looking at the wrong page. The
// first run of this probe measured exactly that and reported nine
// divergences that were not there.
for (const [port, what] of [[CDP_PORT, 'a browser'], [FIXTURE_PORT, 'the fixture']]) {
  const taken = await fetch(`http://127.0.0.1:${String(port)}/`, { signal: AbortSignal.timeout(500) })
    .then(() => true).catch(() => false)
  if (taken) {
    console.error(`probe: port ${String(port)} is already serving something; ${what} cannot start there`)
    process.exit(1)
  }
}

const browser = spawn('obscura', [
  'serve', '--port', String(CDP_PORT), '--allow-private-network', '--workers', '1',
], { stdio: 'ignore', detached: true })

/** Give the engine and the fixture a moment to bind; both do in well under a second. */
await new Promise((resolve) => setTimeout(resolve, 2000))

let answered = 0
let differed = 0

/**
 * Run one CLI command and judge what came back.
 *
 * @param {string} label - what is being measured.
 * @param {string[]} args - the command, as an agent would type it.
 * @param {(output: string) => boolean} expected - what a working answer contains.
 * @returns {string} the command's output, for the next step to read refs out of.
 */
function measure(label, args, expected) {
  // A command whose target never got a ref is not a command that failed; it is
  // an element the snapshot did not offer. Sending the empty string reaches
  // the CLI as an empty CSS selector and comes back as a parse error, which
  // says nothing about the browser.
  if (args.some((argument) => argument === '')) {
    console.log(`  DIFFERS  ${label.padEnd(34)} the snapshot offered no ref for this element`)
    differed += 1
    return ''
  }
  const run = spawnSync('playwright-cli', args, {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
    timeout: 60_000,
  })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  if (run.error !== undefined) {
    console.log(`  ABSENT   ${label.padEnd(34)} ${run.error.message}`)
    differed += 1
    return output
  }
  if (expected(output)) {
    console.log(`  ANSWERS  ${label}`)
    answered += 1
    return output
  }
  // The first line of the complaint, which is the part that names the
  // difference. The call log under it is Playwright's and is the same every
  // time something is not actionable.
  const why = output.split('\n').filter((line) => line.trim() !== '')[1] ?? output.trim()
  console.log(`  DIFFERS  ${label.padEnd(34)} ${why.slice(0, 90)}`)
  differed += 1
  return output
}

/**
 * The ref a snapshot gives one element, by the name it carries.
 *
 * @param {string} snapshotOutput - what `snapshot` printed.
 * @param {string} needle - text that appears on the element's line.
 * @returns {string} the ref, or an empty string when the snapshot has no such line.
 */
function refFor(snapshotOutput, needle) {
  // A snapshot comes back one of two ways: printed inline in a fenced block
  // when it is small, and written to a file with a link to it when it is not.
  // Reading only the file missed every small page, which is every fixture.
  const file = /\((\.playwright-cli\/[^)]+\.yml)\)/.exec(snapshotOutput)?.[1]
  const text = file === undefined ? snapshotOutput : fs.readFileSync(path.join(work, file), 'utf8')
  const line = text.split('\n').find((row) => row.includes(needle) && row.includes('[ref='))
  if (line === undefined) {
    // Said out loud, because an empty ref reaches the CLI as an empty selector
    // and comes back as a CSS parse error — which reads like the command is
    // broken when what is missing is the element.
    console.log(`  (nothing named "${needle}" carries a ref in the snapshot)`)
    return ''
  }
  return /\[ref=([^\]]+)\]/.exec(line)?.[1] ?? ''
}

const base = `http://127.0.0.1:${String(FIXTURE_PORT)}`
console.log(`\n=== what the sandbox's browser answers (obscura ${version()}) ===\n`)

// The title is a marker rather than a name: a port that turns out to be
// serving something else — a leftover from an earlier run, a tenant's own dev
// server — would otherwise be measured as if it were the fixture, and every
// ref below would come back empty.
measure('open', ['open', base], (out) => out.includes('obscura-probe-fixture'))
const snapshot = measure('snapshot', ['snapshot'], (out) => out.includes('Snapshot'))
measure('eval', ['eval', '() => document.title'], (out) => out.includes('obscura-probe-fixture'))
measure('find', ['find', 'press me'], (out) => out.includes('press me'))

const button = refFor(snapshot, 'press me')
const field = refFor(snapshot, 'a text field')
const checkbox = refFor(snapshot, 'a checkbox')
const dropdown = refFor(snapshot, 'a select')
const hoverable = refFor(snapshot, 'hover me')
const link = refFor(snapshot, 'second page')

measure('click', ['click', button], (out) => !out.includes('### Error'))
measure('  and the click was seen', ['eval', '() => document.getElementById("said").textContent'],
  (out) => out.includes('pressed'))
measure('fill', ['fill', field, 'typed by the probe'], (out) => !out.includes('### Error'))
measure('  and the value landed', ['eval', '() => document.getElementById("text").value'],
  (out) => out.includes('typed by the probe'))
measure('type', ['type', 'more text'], (out) => !out.includes('### Error'))
measure('press', ['press', 'Tab'], (out) => !out.includes('### Error'))
measure('check', ['check', checkbox], (out) => !out.includes('### Error'))
measure('select', ['select', dropdown, 'two'], (out) => !out.includes('### Error'))
measure('hover', ['hover', hoverable], (out) => !out.includes('### Error'))
measure('resize', ['resize', '1024', '768'], (out) => !out.includes('### Error'))
measure('screenshot', ['screenshot'], (out) => !out.includes('### Error'))
measure('pdf', ['pdf'], (out) => !out.includes('### Error'))
measure('navigate by clicking a link', ['click', link], (out) => !out.includes('### Error'))
measure('  and the page changed', ['eval', '() => document.title'], (out) => out.includes('Second'))
measure('back', ['back'], (out) => !out.includes('### Error'))
measure('close', ['close'], (out) => !out.includes('### Error'))

console.log(`\n=== ${String(answered)} answered, ${String(differed)} differed ===\n`)

/**
 * The engine's own version string, for the line above the table.
 *
 * @returns {string} the version, or a question mark when the binary will not say.
 */
function version() {
  const run = spawnSync('obscura', ['--version'], { encoding: 'utf8' })
  return (run.stdout ?? '').trim().split(' ').pop() ?? '?'
}

// Both were started detached so they could outlive a blocking call; both are
// stopped by their process group. Already-gone is not an error worth throwing
// on the last line of a probe that has already printed its answer.
for (const child of [browser, fixture]) {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // it stopped on its own
  }
}
if (differed === 0) fs.rmSync(work, { recursive: true, force: true })
else console.log(`what it saw is left in ${work}\n`)
process.exit(0)
