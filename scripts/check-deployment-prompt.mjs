/**
 * The prompt corrections have to survive being read by nobody.
 *
 * DSH tells the agent it is talking to a person at http://127.0.0.1:3080 and
 * that /app is a checkout to extend. Both are false in this deployment, and
 * both fail quietly: the agent hands a tenant a link that resolves only inside
 * their sandbox, or edits a harness no image will ever carry. The plugin
 * rewrites those two sections through the `system-prompt/assemble` waterfall,
 * and every way that rewrite can stop happening is silent — a listener that
 * returns without `next()` drops the rest of the chain, a replacement that
 * quietly kept a loopback address puts the same link back, and a section name
 * upstream renamed leaves the original text in place with nothing said.
 *
 * So this runs the real listener over a synthetic assembly and reads what came
 * out, rather than grepping the source for sentences it hopes are there.
 *
 * Run: node scripts/check-deployment-prompt.mjs
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const plugin = await import('../packages/dsh-deployment-prompt/index.js')
const source = readFileSync(resolve(root, 'packages/dsh-deployment-prompt/index.js'), 'utf8')

const problems = []
const fail = (message) => problems.push(message)

/**
 * Mount the plugin against a context that records what it was asked for.
 * @returns {{sections: {name: string, order: number, text: string}[], listener: Function, warnings: string[]}} what apply() registered.
 */
function mount() {
  const sections = []
  const listeners = []
  const warnings = []
  plugin.apply({
    systemPrompt: { section: (section) => sections.push(section) },
    on: (event, listener) => { if (event === 'system-prompt/assemble') listeners.push(listener) },
    logger: { warn: (line) => warnings.push(line) },
  })
  if (listeners.length !== 1) fail(`apply() registered ${listeners.length} system-prompt/assemble listeners, not one`)
  return { sections, listener: listeners[0], warnings }
}

// The two upstream names, as this repository knows them. Stated here and
// nowhere else in the check, because check-images.sh asserts the same two
// against the installed harness bundles.
const UPSTREAM = ['app:web-surface', 'harness:source']

// An address a tenant's browser cannot resolve, and the shape of a frontend
// checkout that exists in DSH's own tree and not in this image. Each of these
// appears in the text being replaced, so finding one in the replacement means
// the correction copied the mistake forward.
const FORBIDDEN = ['localhost', '127.0.0.1', '0.0.0.0', 'apps/web', 'pnpm run dev:web']

const { sections, listener, warnings } = mount()

if (sections.length !== 1) fail(`apply() registered ${sections.length} sections, not one`)
const own = sections[0]

if (own !== undefined) {
  // The name the prompt registry already owns. Registering it a second time in
  // the same layer throws at mount, and setting it from cordis.patch.yml is
  // shadowed by the agent preset's persona row — neither is a route to this.
  if (own.name === 'deployment:persona') fail('the plugin registers deployment:persona, which the prompt registry owns and an agent preset shadows')
  if (!Number.isFinite(own.order)) fail(`the plugin's section order is ${String(own.order)}, which the registry rejects`)
  if (typeof own.text !== 'string' || own.text.length === 0) fail('the plugin registers a section with no text')
  else {
    if (!own.text.includes('/mnt/workspace')) fail('the plugin section does not name /mnt/workspace, so nothing tells the agent where a deliverable goes')
    if (!/discard/i.test(own.text)) fail('the plugin section does not say the rest of the filesystem is discarded')
    if (!/sandbox/i.test(own.text)) fail('the plugin section does not say this machine is a sandbox rather than the user\'s own computer')
    if (!/gateway/i.test(own.text)) fail('the plugin section does not say the user arrives through the gateway')
  }
}

// The chain, not just the edit. A listener that never awaits next() returns
// before the agent plane has contributed its variables, and the failure is a
// prompt missing a model name rather than an error.
let chained = false
const downstream = {
  sections: [
    { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
    { name: 'harness:source', text: 'The DeepSeek Harness implementation checkout is at /app/. Use pwd to determine the current working directory.' },
    { name: 'app:web-surface', text: 'You are interacting with the user through the DeepSeek Harness Web GUI at http://127.0.0.1:3080. Every other change — the apps/web shell and plain packages — requires rebuilding.' },
    { name: 'deployment:persona', text: 'You are a coding agent.' },
  ],
  contexts: [{ name: 'runtime:cwd', text: '/mnt/workspace' }],
  tools: ['bash'],
  variables: { model: 'a-model' },
}

const assembled = await listener({ sections: [] }, {}, async () => {
  chained = true
  return downstream
})

if (!chained) fail('the listener returned without awaiting next(), so every other assemble listener is dropped')
if (assembled.contexts !== downstream.contexts) fail('the listener did not pass the downstream contexts through')
if (assembled.tools !== downstream.tools) fail('the listener did not pass the downstream tools through')
if (assembled.variables !== downstream.variables) fail('the listener did not pass the downstream variables through')
if (assembled.sections.length !== downstream.sections.length) fail(`the listener returned ${assembled.sections.length} sections for ${downstream.sections.length} in`)

const byName = new Map(assembled.sections.map((section) => [section.name, section.text]))

for (const name of UPSTREAM) {
  const before = downstream.sections.find((section) => section.name === name)?.text
  const after = byName.get(name)
  if (after === undefined) { fail(`the listener dropped the ${name} section instead of rewriting it`); continue }
  if (after === before) fail(`the listener left ${name} as the harness wrote it — the correction is not applied`)
  for (const token of FORBIDDEN) {
    if (after.includes(token)) fail(`the ${name} replacement still contains ${token}, which is what the original said and what a tenant cannot use`)
  }
}

for (const [name, text] of byName) {
  if (UPSTREAM.includes(name)) continue
  const before = downstream.sections.find((section) => section.name === name)?.text
  if (text !== before) fail(`the listener rewrote ${name}, which it does not own`)
}

// The one thing that must be loud without being fatal. An upstream rename
// leaves the wrong text shipping, and a throw here would take every session in
// the deployment down over a prompt wording change.
const renamed = mount()
const warnedOn = await renamed.listener({ sections: [] }, {}, async () => ({
  ...downstream,
  sections: downstream.sections.filter((section) => !UPSTREAM.includes(section.name)),
}))
if (warnedOn.sections.length !== 2) fail('the listener did not pass an assembly with neither target section through unchanged')
for (const name of UPSTREAM) {
  if (!renamed.warnings.some((line) => line.includes(name))) fail(`nothing was logged when ${name} was absent, so an upstream rename would ship in silence`)
}
if (warnings.length > 0) fail(`the listener warned on a complete assembly: ${warnings.join('; ')}`)

// Named in the source as well, because the two upstream constants are what
// check-images.sh greps for in the installed bundles; a plugin that stopped
// naming one of them would leave that grep asserting nothing.
for (const name of UPSTREAM) {
  if (!source.includes(name)) fail(`the plugin source does not name ${name}, so the image-side grep has no subject`)
}
if (!/await next\(\)/.test(source)) fail('the plugin does not await next(), so it cannot be composing the waterfall')

if (problems.length > 0) {
  console.error('check-deployment-prompt: nothing reports this — the agent just tells a tenant to open a URL only the sandbox can resolve')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

console.log('check-deployment-prompt: the harness\'s two on-your-machine sections are rewritten, and the chain still composes')
