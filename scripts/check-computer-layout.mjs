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

import {
  COMPUTER_OPEN_EVENT,
  COMPUTER_PANEL_ANCHOR,
} from '../packages/dsh-artifact-panel/src/constants.js'

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

const duplicatedOpenEvent = /const OPEN_EVENT = '([^']+)'/.exec(computer)?.[1]
assert.equal(duplicatedOpenEvent, COMPUTER_OPEN_EVENT)
assert.match(panel, /window\.addEventListener\(COMPUTER_OPEN_EVENT, openComputer\)/)
assert.match(panel, /event\.preventDefault\(\)/)

const duplicatedAnchor = /const PANEL_ANCHOR = '([^']+)'/.exec(scheduled)?.[1]
assert.equal(
  duplicatedAnchor,
  /const SCHEDULE_PANEL_ANCHOR = '([^']+)'/.exec(computer)?.[1],
  'scheduled-tasks must mount into the exact seat dsh-computer declares',
)
assert.match(computer, /\[SCHEDULE_PANEL_ANCHOR\]: ''/)
assert.match(scheduled, /ReactDomClient\.createRoot\(next\)/)
assert.match(scheduled, /React\.createElement\(ScheduleManager, \{ inline: true \}\)/)

console.log('check-computer-layout: panel, computer and scheduled-task seats agree')
