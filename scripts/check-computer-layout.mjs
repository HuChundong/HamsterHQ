/**
 * The compact Computer pane is a native-aspect card with the scheduler below.
 *
 * This crosses two browser plugins that cannot import each other: the bundled
 * artifact panel declares the seat and the unbundled scheduled-tasks client
 * mounts into it. If either name drifts the build still succeeds and tenants
 * get an empty section, so the tree gate holds the contract together.
 *
 * Run: node scripts/check-computer-layout.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  COMPUTER_FRAME_HEIGHT,
  COMPUTER_FRAME_WIDTH,
  SCHEDULE_PANEL_ANCHOR,
} from '../packages/dsh-artifact-panel/src/constants.js'
import { CSS } from '../packages/dsh-artifact-panel/src/styles.js'

const root = resolve(import.meta.dirname, '..')
const pane = readFileSync(resolve(root, 'packages/dsh-artifact-panel/src/computer-pane.js'), 'utf8')
const scheduled = readFileSync(resolve(root, 'packages/dsh-scheduled-tasks/client.js'), 'utf8')

assert.equal(COMPUTER_FRAME_WIDTH, 1280)
assert.equal(COMPUTER_FRAME_HEIGHT, 720)
assert.equal(COMPUTER_FRAME_WIDTH / COMPUTER_FRAME_HEIGHT, 16 / 9)
assert.match(
  CSS,
  new RegExp(`aspect-ratio:\\s*${String(COMPUTER_FRAME_WIDTH)} / ${String(COMPUTER_FRAME_HEIGHT)}`),
  'the compact desktop card must keep the native 1280:720 aspect',
)

assert.match(pane, /'data-maximised': String\(maximised\)/)
assert.match(pane, /maximised \? null : h\('div', \{/)
assert.match(pane, /\[SCHEDULE_PANEL_ANCHOR\]: ''/)

const duplicatedAnchor = /const PANEL_ANCHOR = '([^']+)'/.exec(scheduled)?.[1]
assert.equal(
  duplicatedAnchor,
  SCHEDULE_PANEL_ANCHOR,
  'scheduled-tasks must mount into the exact seat the artifact panel declares',
)
assert.match(scheduled, /ReactDomClient\.createRoot\(next\)/)
assert.match(scheduled, /React\.createElement\(ScheduleManager, \{ inline: true \}\)/)

console.log('check-computer-layout: compact desktop aspect and scheduled-task seat agree')
