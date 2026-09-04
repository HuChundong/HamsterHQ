/**
 * dsh-computer owns the native-aspect desktop and the scheduler below it.
 *
 * This crosses two browser plugins that cannot import each other: the bundled
 * artifact panel declares the desktop seat, dsh-computer renders into it and
 * declares the schedule seat, and scheduled-tasks renders there. If any name
 * drifts the build still succeeds and tenants get an empty section, so this
 * gate holds both contracts together.
 *
 * Run: node scripts/check-computer-layout.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { COMPUTER_PANEL_ANCHOR } from '../packages/dsh-artifact-panel/src/constants.js'

const root = resolve(import.meta.dirname, '..')
const panel = readFileSync(resolve(root, 'packages/dsh-artifact-panel/src/client.js'), 'utf8')
const computer = readFileSync(resolve(root, 'packages/dsh-computer/client.js'), 'utf8')
const scheduled = readFileSync(resolve(root, 'packages/dsh-scheduled-tasks/client.js'), 'utf8')

const duplicatedPanelAnchor = /const PANEL_ANCHOR = '([^']+)'/.exec(computer)?.[1]
assert.equal(duplicatedPanelAnchor, COMPUTER_PANEL_ANCHOR)
assert.match(panel, /\[COMPUTER_PANEL_ANCHOR\]: ''/)
assert.match(computer, /aspect-ratio: 1280 \/ 720/)
assert.match(computer, /'data-maximised': String\(maximised\)/)
assert.match(computer, /maximised \? null : h\('div'/)

// The takeover is this plugin's own full-window surface, not a request the
// panel grants. Nothing may re-introduce a DOM event between the two halves:
// the seat below is the whole contract they share.
assert.doesNotMatch(computer, /dsh-computer:open/)
assert.doesNotMatch(panel, /dsh-computer:open/)

const duplicatedAnchor = /const PANEL_ANCHOR = '([^']+)'/.exec(scheduled)?.[1]
assert.equal(
  duplicatedAnchor,
  /const SCHEDULE_PANEL_ANCHOR = '([^']+)'/.exec(computer)?.[1],
  'scheduled-tasks must mount into the exact seat dsh-computer declares',
)
assert.match(computer, /\[SCHEDULE_PANEL_ANCHOR\]: ''/)
assert.match(scheduled, /ReactDomClient\.createRoot\(next\)/)
assert.match(scheduled, /React\.createElement\(ScheduleManager, \{ inline: true \}\)/)

// The Computer has to be reachable with no session open. The session header
// is not drawn until a session exists, so the header seat alone left a new
// conversation with no way to the desktop at all — the sidebar's foot is the
// one place the shell draws either way.
assert.match(panel, /id: 'artifact-panel-computer', order: 40 \}/)
assert.match(panel, /name: 'sidebar\.footer\.action'/)
assert.match(panel, /function SidebarComputer\(/)

// Two copies of one DOM walk, in plugins that cannot import each other: the
// slot anchor is display:contents, so each footer seat has to find the flex
// row itself. Relying on the other plugin's copy is not enough — scheduled
// tasks hides its seat when the gateway serves none, and then nothing runs.
const stacker = (text) => {
  const start = text.indexOf('stackFooterColumn = (mark) => {')
  return text.slice(start, text.indexOf('\n    }', start)).replace(/\s+/g, ' ')
}
assert.equal(
  stacker(panel),
  stacker(scheduled),
  'both footer seats must column the sidebar row the same way',
)

// The two Computer controls have opposite shapes and one stylesheet. The
// header rail's rule is a four-selector list ending in `-computer-launch`, and
// a block dropped between those selectors and their brace does not fail to
// parse — it silently hands the sidebar row's `width: 100%` to every button in
// the session header. That is how it broke: the shape rule and the sidebar
// rule have to be separate rules, and the rail's list has to stay whole.
const styles = readFileSync(resolve(root, 'packages/dsh-artifact-panel/src/styles.js'), 'utf8')
const rail = /\[data-slot='conversation\.session\.header\.utilities'\] button,\s*\.\$\{NS\}-opener,\s*\.\$\{NS\}-toggle,\s*\.\$\{NS\}-computer-launch \{([^}]*)\}/
const shape = rail.exec(styles)
assert.notEqual(shape, null, 'the header rail shape rule must keep all four selectors on one block')
assert.match(shape[1], /width: 28px/)
assert.doesNotMatch(shape[1], /width: 100%/)

for (const [, selector] of styles.matchAll(/([^{}]*)\{[^{}]*\}/g)) {
  if (!selector.includes('-computer-open')) continue
  assert.doesNotMatch(
    selector,
    /header\.utilities|-opener|-toggle|-computer-launch/,
    `the sidebar seat must not share a rule with a header control: ${selector.trim()}`,
  )
}

console.log('check-computer-layout: panel, computer and scheduled-task seats agree')
