/**
 * Generate path data for the glyphs the harness set does not carry.
 *
 * A name that matches is not a meaning that matches: `copy` and `copy-text`
 * are two buttons side by side and must not become the same glyph; `shrink`
 * is leaving fullscreen and the harness set draws only entering it;
 * `terminal` would collide with the glyph this panel already shows for a
 * code file.
 *
 * The input set is lucide-static: a 24-grid stroke of 2/24 of its box
 * against the harness's 1.3/16, stroked rather than solid. Path data is
 * generated rather than depended on at runtime because the pages that read
 * it are static documents with no module table. Attribution is in NOTICE.
 *
 * Run: node packages/dsh-icons/extract.mjs   (needs lucide-static installed)
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname)

/**
 * Our name for the glyph, and the lucide-static file it comes from.
 *
 * Chosen by what the icon has to say where this deployment shows it, not by
 * whose name is closest. Each line says why where the choice was not obvious.
 */
const WANTED = {
  terminal: 'terminal',
  // Leaving fullscreen, which is the other half of upstream's `Fullscreen`.
  shrink: 'minimize-2',
  file: 'file',
  // The file's CONTENTS, next to a button that copies its PATH. Two sheets,
  // because the thing being taken is what is written on them.
  'copy-text': 'files',
  image: 'image',
  // Lucide has no markdown mark, and inventing one from a name that merely
  // sounds right is how the wrong glyph gets chosen. A page of prose is what
  // markdown IS here — it is the one kind the panel renders as prose rather
  // than as text — so that is what it wears.
  markdown: 'file-text',
  signout: 'log-out',
  // The front door's, and only the front door's. A shield says the thing
  // behind it is guarded; behind the console link are three lists of people.
  shield: 'shield',
  list: 'list',
  // The canvas tab. A globe was there first and said "somewhere on the web",
  // which is what the tab SHOWS and not what it is: the page under it is the
  // one the agent is making, and the tab is where the tenant watches it being
  // made. A brush is the making. It also stops the tab and an `.html` file in
  // the tree wearing the same mark, which is the other half of why the globe
  // was wrong — one of them is a tool, the other is a file.
  brush: 'brush',
  // The sandbox is a box a tenant's work sits inside.
  sandbox: 'box',
  // The operator's console, whose sections are administrators, users and
  // invite codes: everyone who has an account, not one being configured.
  people: 'users',

  // The console's sidebar. One per section, and each is the section's subject
  // rather than a decoration for its name: a code that admits somebody is a
  // ticket, a trail of what was done is a history, and the settings are the
  // one thing here that is a machine being adjusted rather than a person being
  // managed.
  ticket: 'ticket',
  history: 'history',
  settings: 'settings',
  // The control that opens and closes the rail. Named for the thing it acts
  // on rather than for a direction: a chevron has to be turned around when the
  // rail is shut, and a panel is the same picture either way.
  panel: 'panel-left',

  // The file tree's kinds. All but `data` are the same sheet `file` is, marked
  // — so a column of them reads as one shape with differences in it rather
  // than as a row of unrelated pictures, which is what a mixed tree has to
  // look like to be scannable at 14px.
  // The harness has a glyph it calls `code`, and it draws a hash — `#`, with
  // the square hole in the middle. Whatever it means there, a `.py` in a file
  // tree wearing it is a file labelled with a symbol from another sentence.
  code: 'file-code',
  data: 'file-braces',
  archive: 'file-archive',
  table: 'file-spreadsheet',
  media: 'file-video',
}

/** The generator's input package. */
const PACKAGE = 'lucide-static'

/**
 * One attribute of one element, as a number.
 * @param {string} element - the element's source.
 * @param {string} name - the attribute.
 * @returns {number} its value.
 */
function attribute(element, name) {
  const found = new RegExp(`\\s${name}="([^"]+)"`).exec(element)
  if (found === null) throw new Error(`extract: an element is missing ${name}: ${element}`)
  return Number(found[1])
}

/**
 * Every drawing in one glyph, as path data, in document order.
 *
 * Lucide draws with the whole primitive vocabulary. Every kind of SVG
 * primitive must be converted; reading only a path's d would drop the rest
 * silently. An unhandled element must throw. A partial glyph must not ship.
 *
 * @param {string} svg - the file's contents.
 * @param {string} name - the glyph, for the errors.
 * @returns {string[]} the path data.
 */
function paths(svg, name) {
  const body = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1)
  const found = []
  for (const match of body.matchAll(/<([a-z]+)\b([^>]*)\/?>/g)) {
    const [element, tag] = [match[0], match[1]]
    if (tag === 'svg' || tag === 'title' || tag === 'desc' || tag === 'defs' || tag === 'g') continue
    if (tag === 'path') {
      found.push(/\sd="([^"]+)"/.exec(element)?.[1] ?? '')
      continue
    }
    if (tag === 'circle' || tag === 'ellipse') {
      const cx = attribute(element, 'cx')
      const cy = attribute(element, 'cy')
      const rx = tag === 'circle' ? attribute(element, 'r') : attribute(element, 'rx')
      const ry = tag === 'circle' ? rx : attribute(element, 'ry')
      // Two half arcs, because one arc cannot close on its own start point.
      found.push(`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`)
      continue
    }
    if (tag === 'rect') {
      const x = attribute(element, 'x')
      const y = attribute(element, 'y')
      const w = attribute(element, 'width')
      const h = attribute(element, 'height')
      const r = /\srx="([^"]+)"/.test(element) ? attribute(element, 'rx') : 0
      found.push(r === 0
        ? `M${x} ${y}h${w}v${h}h${-w}z`
        : `M${x + r} ${y}h${w - r * 2}a${r} ${r} 0 0 1 ${r} ${r}v${h - r * 2}`
          + `a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r * 2)}a${r} ${r} 0 0 1 ${-r} ${-r}`
          + `v${-(h - r * 2)}a${r} ${r} 0 0 1 ${r} ${-r}z`)
      continue
    }
    if (tag === 'line') {
      found.push(`M${attribute(element, 'x1')} ${attribute(element, 'y1')}`
        + `L${attribute(element, 'x2')} ${attribute(element, 'y2')}`)
      continue
    }
    if (tag === 'polyline' || tag === 'polygon') {
      const points = /\spoints="([^"]+)"/.exec(element)?.[1] ?? ''
      const numbers = points.trim().split(/[\s,]+/)
      if (numbers.length < 4) throw new Error(`extract: ${name} has a ${tag} with too few points`)
      const pairs = []
      for (let at = 0; at < numbers.length; at += 2) pairs.push(`${numbers[at]} ${numbers[at + 1]}`)
      found.push(`M${pairs.join('L')}${tag === 'polygon' ? 'z' : ''}`)
      continue
    }
    throw new Error(`extract: ${name} draws with <${tag}>, which this does not convert — add it rather than losing it`)
  }
  if (found.length === 0) throw new Error(`extract: ${name} has no drawing at all`)
  if (found.some((d) => d === '')) throw new Error(`extract: ${name} has a <path> with no d`)
  return found
}

const install = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', '--prefix', install, PACKAGE], {
  stdio: ['ignore', 'ignore', 'inherit'],
})
const base = join(install, 'node_modules', PACKAGE)
const version = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).version

/**
 * How heavy upstream's line is, as a fraction of the glyph's own box.
 *
 * The harness draws on a 16 grid with a 1.3 stroke expanded to a filled
 * outline, so its line is 1.3/16 of the box wherever it is rendered. Lucide
 * draws on a 24 grid with a 2 stroke, which is 2/24 — within two per cent of
 * the same weight, which is why these can sit in one row without either
 * looking bolder than the other.
 *
 * Checked rather than assumed, because it is the whole argument for taking a
 * 24-grid set into a 16-grid interface: nothing is rescaled, the two are
 * simply drawn at the same relative weight and the browser fits each to
 * whatever size the call site asks for.
 */
const UPSTREAM_WEIGHT = 1.3 / 16

/** How far from upstream's weight a glyph may be and still belong in the row. */
const WEIGHT_TOLERANCE = 0.1

const glyphs = Object.fromEntries(Object.entries(WANTED).map(([key, file]) => {
  const svg = readFileSync(join(base, 'icons', `${file}.svg`), 'utf8')
  const box = /viewBox="([^"]+)"/.exec(svg)?.[1]
  if (box === undefined) throw new Error(`extract: ${file} has no viewBox`)
  const edge = Number(box.split(/\s+/)[2])
  const width = Number(/stroke-width="([^"]+)"/.exec(svg)?.[1] ?? '0')
  if (!(edge > 0) || !(width > 0)) throw new Error(`extract: ${file} is not a stroked glyph on a square box`)
  const weight = width / edge
  const drift = Math.abs(weight - UPSTREAM_WEIGHT) / UPSTREAM_WEIGHT
  if (drift > WEIGHT_TOLERANCE) {
    throw new Error(`extract: ${file} draws its line at ${weight.toFixed(4)} of its box, ${(drift * 100).toFixed(0)}% off the harness's ${UPSTREAM_WEIGHT.toFixed(4)}`)
  }
  return [key, {
    from: file,
    viewBox: box,
    paths: paths(svg, file),
    // Carried with the glyph rather than assumed by whoever draws it: this
    // half is stroked and the mirrored half is filled, and a renderer that
    // guessed would paint one of them as a blot.
    stroke: {
      width,
      linecap: /stroke-linecap="([^"]+)"/.exec(svg)?.[1] ?? 'round',
      linejoin: /stroke-linejoin="([^"]+)"/.exec(svg)?.[1] ?? 'round',
    },
  }]
}))

const body = Object.entries(glyphs).map(([key, glyph]) => {
  const list = glyph.paths.map((d) => `\n      '${d}',`).join('')
  const paint = `\n    stroke: { width: ${String(glyph.stroke.width)}, linecap: '${glyph.stroke.linecap}', linejoin: '${glyph.stroke.linejoin}' },`
  return `  '${key}': {\n    from: '${glyph.from}',\n    viewBox: '${glyph.viewBox}',\n    paths: [${list}\n    ],${paint}\n  },`
}).join('\n')

writeFileSync(join(root, 'extracted.js'), `/**
 * Glyphs the harness set does not carry. Generated by extract.mjs; do not
 * edit this file. Attribution is in NOTICE.
 *
 * @module extracted
 */

/** The generator's input set. */
export const EXTRACTED_SET = '${PACKAGE}'

/** The generator's input version of ${PACKAGE}. */
export const EXTRACTED_FROM = '${version}'

/** The set, by this deployment's name for each glyph. */
export const extracted = Object.freeze({
${body}
})
`)

process.stdout.write(`extracted ${String(Object.keys(glyphs).length)} glyphs from ${PACKAGE}@${version}\n`)
