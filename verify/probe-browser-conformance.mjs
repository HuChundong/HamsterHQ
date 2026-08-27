/**
 * How much of what `playwright-cli` asks for the sandbox's browser answers.
 *
 * The engine is chrome-headless-shell now, so the command table should answer
 * in full — but "should" is the same kind of claim as "E2B compatible", and
 * this repository does not build on that word either. So the commands the
 * bundled skill tells an agent to use are run, one at a time, against a page
 * whose contents are known, and each is recorded as answering, differing, or
 * missing. The probe kept its shape across the engine swap on purpose: it was
 * written for an independent engine and it is what would catch the next one,
 * or a Chromium build that stopped answering something the skill teaches.
 *
 * One measurement here is of the image rather than the engine: whether CJK
 * text rasterizes as glyphs or as boxes. Chromium draws with the system's
 * fontconfig stack, so this holds the image's font install to account — the
 * previous engine drew only from fonts embedded in its binary, and every
 * Chinese page screenshotted as boxes while every command still "answered".
 * Two screenshots that differ only in their Chinese characters must differ as
 * bytes; tofu boxes are the same box every time.
 *
 * Run it when `PLAYWRIGHT_CLI_VERSION` moves, which is what pins the browser.
 * What it prints is the list a person decides about — not every divergence is
 * worth blocking an upgrade, and the ones that are should be named in docs
 * rather than discovered by a tenant.
 *
 * Hermetic on purpose. The fixture is served from inside the sandbox, so the
 * result says something about the browser rather than about the network that
 * day. The probe starts its own browser on its own port beside the sandbox's
 * resident one, and stops it when it is done.
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
<head><meta charset="utf-8"><title>browser-probe-fixture</title></head>
<body>
  <h1 id="title">browser-probe-fixture</h1>
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

/**
 * Two pages that differ only in their Chinese characters, same count, same
 * layout. A font stack that has the glyphs draws two different rasters; one
 * that does not draws the same row of boxes twice. Everything else on the
 * page is identical so the byte comparison measures exactly the glyphs.
 *
 * @param {string} text - the Chinese text this variant carries.
 * @returns {string} the page.
 */
const cjkPage = (text) => `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>cjk-probe</title></head>
<body><p style="font-size:32px">${text}</p></body></html>`

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
fs.writeFileSync(path.join(pages, 'cjk-a.html'), cjkPage('中文字形探针甲'))
fs.writeFileSync(path.join(pages, 'cjk-b.html'), cjkPage('汉语笔画测量乙'))
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

// The flags come from the same file the entrypoint reads, so the probe
// measures the browser a tenant runs rather than a differently-shaped one.
// What differs is only what belongs to the caller: the port, and a profile
// and cache in the probe's own scratch directory.
const FLAGS = fs.readFileSync('/app/sandbox/browser-flags', 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))
const browser = spawn('/usr/local/bin/headless-shell', [
  ...FLAGS,
  `--remote-debugging-port=${String(CDP_PORT)}`,
  `--user-data-dir=${path.join(work, 'profile')}`,
  `--disk-cache-dir=${path.join(work, 'cache')}`,
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
console.log(`\n=== what the sandbox's browser answers (chrome-headless-shell ${version()}) ===\n`)

// The title is a marker rather than a name: a port that turns out to be
// serving something else — a leftover from an earlier run, a tenant's own dev
// server — would otherwise be measured as if it were the fixture, and every
// ref below would come back empty.
measure('open', ['open', base], (out) => out.includes('browser-probe-fixture'))
const snapshot = measure('snapshot', ['snapshot'], (out) => out.includes('Snapshot'))
measure('eval', ['eval', '() => document.title'], (out) => out.includes('browser-probe-fixture'))
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

// The image's fonts, measured through the engine. Two screenshots of pages
// that differ only in their Chinese characters must differ as bytes: a font
// stack without the glyphs draws the same row of boxes twice, while every
// command above still answers. This is the one check here that judges the
// image rather than the browser, and it exists because the previous engine
// passed the whole table while screenshotting Chinese as tofu.
const shotPath = (output) => /\((\.playwright-cli\/[^)]+\.(?:png|jpe?g))\)/.exec(output)?.[1] ?? ''
measure('goto a Chinese page', ['goto', `${base}/cjk-a.html`], (out) => !out.includes('### Error'))
const shotA = shotPath(measure('  and screenshot it', ['screenshot'], (out) => !out.includes('### Error')))
measure('goto one with different characters', ['goto', `${base}/cjk-b.html`], (out) => !out.includes('### Error'))
const shotB = shotPath(measure('  and screenshot it too', ['screenshot'], (out) => !out.includes('### Error')))
if (shotA !== '' && shotB !== ''
  && !fs.readFileSync(path.join(work, shotA)).equals(fs.readFileSync(path.join(work, shotB)))) {
  console.log('  ANSWERS  CJK glyphs render')
  answered += 1
} else {
  console.log(`  DIFFERS  ${'CJK glyphs render'.padEnd(34)} the two screenshots are identical — the font stack has no CJK glyphs`)
  differed += 1
}

measure('close', ['close'], (out) => !out.includes('### Error'))

console.log(`\n=== ${String(answered)} answered, ${String(differed)} differed ===\n`)

/**
 * The engine's own version string, for the line above the table.
 *
 * @returns {string} the version, or a question mark when the binary will not say.
 */
function version() {
  const run = spawnSync('/usr/local/bin/headless-shell', ['--version'], { encoding: 'utf8' })
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
