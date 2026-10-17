/**
 * The two patch layers agree about what they inject.
 *
 * `sandbox/cordis.patch.yml` and `sandbox/harvest.patch.yml` are deliberately
 * near-duplicates: the harvest is the sandbox composition minus its tunnel, so
 * a row that injects a service in one has to inject it in the other, or the two
 * disagree about two compositions that are meant to be the same.
 *
 * What this does NOT do is catch the failure that motivated it. The 0.2.1
 * upgrade retargeted `connection` from a service upstream had deleted, and both
 * layers carried the stale name together — a check comparing them to each other
 * would have called the pair consistent. Catching that needs upstream's own
 * patch, which exists only inside the image, so it lives in
 * `scripts/check-images.sh`. This one is the cheap half: it fails when a fix
 * lands in one layer and not the other, which hand-editing duplicates invites.
 *
 * An override replaces a row's top-level key outright — `inject` included —
 * which is why a stale name here is worse than an unused one: it is the whole
 * list, not an addition to it.
 *
 * Run: node scripts/check-patch-inject.mjs
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')

/** The patch layers that must agree, in the order a reader meets them. */
const LAYERS = ['sandbox/cordis.patch.yml', 'sandbox/harvest.patch.yml']

const problems = []

/**
 * One layer's `id -> inject` map, read as text.
 *
 * Parsed by hand rather than with a YAML module: the files carry `!!js` tags
 * that a plain parser rejects, and this reads one scalar list off its own line.
 * `check-dockerfile.mjs` reads the same files the same way.
 *
 * @param {string} source - the patch file.
 * @param {string} file - its path, for the report.
 * @returns {Map<string, string[]>} inject lists by row id.
 */
function injectLists(source, file) {
  const found = new Map()
  let id
  for (const line of source.split('\n')) {
    const row = /^- id: (\S+)$/.exec(line)
    if (row !== null) {
      id = row[1]
      continue
    }
    // A group's children are indented; their ids are the ones `insert` targets.
    const child = /^ {4}- id: (\S+)$/.exec(line)
    if (child !== null) {
      id = child[1]
      continue
    }
    const inject = /^\s*inject:\s*\[([^\]]*)\]\s*$/.exec(line)
    if (inject === null) continue
    if (id === undefined) {
      problems.push(`${file}: an inject list appears before any row id`)
      continue
    }
    if (found.has(id)) problems.push(`${file}: ${id} declares inject twice`)
    const names = inject[1].split(',').map(name => name.trim()).filter(name => name !== '')
    if (names.length === 0) problems.push(`${file}: ${id} declares an empty inject list`)
    found.set(id, names)
  }
  return found
}

const lists = LAYERS.map(file => ({
  file,
  inject: injectLists(readFileSync(join(root, file), 'utf8'), file),
}))

const [first, ...rest] = lists
for (const other of rest) {
  for (const [id, names] of first.inject) {
    const there = other.inject.get(id)
    if (there === undefined) {
      problems.push(`${other.file}: does not override ${id}, which ${first.file} does`)
      continue
    }
    const missing = names.filter(name => !there.includes(name))
    const extra = there.filter(name => !names.includes(name))
    if (missing.length > 0) problems.push(`${other.file}: ${id} is missing inject ${missing.join(', ')}`)
    if (extra.length > 0) problems.push(`${first.file}: ${id} is missing inject ${extra.join(', ')}`)
  }
  for (const id of other.inject.keys()) {
    if (!first.inject.has(id)) {
      problems.push(`${first.file}: does not override ${id}, which ${other.file} does`)
    }
  }
}

if (problems.length > 0) {
  console.error('check-patch-inject: the patch layers disagree\n')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`check-patch-inject: ${first.inject.size} overridden row(s) inject the same services in both layers`)
