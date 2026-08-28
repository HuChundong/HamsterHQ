/**
 * The gateway does not know what a schedule is.
 *
 * Scheduled tasks are split across three components, and the split is only
 * worth having if it holds. The gateway's share is an identity and a relay: it
 * proves which tenant is asking, attaches what that tenant is entitled to, and
 * forwards a body it reads only far enough to forward. What it must never
 * acquire is an opinion about when something is due — the moment it can answer
 * that, the clock has moved into the process that authenticates every tenant
 * and holds the Docker socket, and the reason for a separate service is gone.
 *
 * Two things are checked, and both are the shape that drift actually takes.
 * Nobody moves a scheduler wholesale; somebody adds one convenient query, or
 * imports a cron parser to show a tenant their next occurrence without a round
 * trip. Each is one line, each looks harmless in review, and together they are
 * the boundary gone.
 *
 * What this cannot check is whether the relay stays a relay — a gateway that
 * parsed a rule to validate it would pass. That is what review is for. What it
 * makes impossible is the silent version.
 *
 * Run: node scripts/check-scheduler-boundary.mjs
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')

/** The tables the scheduler owns, which nothing else may name. */
const TABLES = ['scheduled_tasks', 'scheduled_runs']

/**
 * Packages that read a schedule rather than carry one.
 *
 * A cron parser in the gateway is the exact mistake this guards: it would mean
 * the gateway can compute an occurrence, which is the scheduler's whole job.
 */
const PARSERS = ['cron-parser', 'cronstrue', 'node-cron', 'croner']

const problems = []

/**
 * Every JavaScript file under a directory, recursively.
 * @param {string} directory - where to look, relative to the repository root.
 * @returns {Array<{relative: string, text: string}>} the sources.
 */
function sources(directory) {
  const found = []
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const relative = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      found.push(...sources(relative))
      continue
    }
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) continue
    found.push({ relative, text: readFileSync(join(root, relative), 'utf8') })
  }
  return found
}

for (const { relative, text } of sources('gateway/src')) {
  // Comments are stripped first. This file's own boundary is explained in the
  // prose of `gateway/src/schedules.js`, which names both tables to say it
  // does not query them — and a check that read its own justification as a
  // violation would be a check nobody could satisfy honestly.
  const code = text
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '')
  for (const table of TABLES) {
    if (code.includes(table)) {
      problems.push(`${relative} names \`${table}\` — that table belongs to the scheduler, which is the only thing that may query it`)
    }
  }
}

const manifest = JSON.parse(readFileSync(join(root, 'gateway/package.json'), 'utf8'))
const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
for (const parser of PARSERS) {
  if (declared.includes(parser)) {
    problems.push(`gateway/package.json depends on \`${parser}\` — computing an occurrence is the scheduler's job, not the front door's`)
  }
}

// And the other direction, which is the cheaper half of the same rule: the
// scheduler must not acquire a way to reach a sandbox. Its shortness is the
// separation showing up somewhere it can be counted.
const clock = JSON.parse(readFileSync(join(root, 'scheduler/package.json'), 'utf8'))
for (const forbidden of ['e2b', '@cubesandbox/sdk', 'ws', 'dockerode', 'dsh-tunnel-protocol']) {
  if (Object.keys(clock.dependencies ?? {}).includes(forbidden)) {
    problems.push(`scheduler/package.json depends on \`${forbidden}\` — the scheduler asks the gateway for a machine and has no way to reach one itself`)
  }
}

if (problems.length > 0) {
  console.error('check-scheduler-boundary: the split has started to leak\n')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`check-scheduler-boundary: the gateway names neither scheduler table and parses no cron`)
