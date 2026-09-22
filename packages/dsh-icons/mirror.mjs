/**
 * Generate `mirrored.js` from the harness icon package pinned by `DSH_VERSION`.
 *
 * The output is committed so CI can read it without a registry. Only the
 * glyphs the surfaces outside the shell need are generated. Everything
 * rendered inside the shell — all four plugins' browser halves — requires
 * `@deepseek-ai/dsh-client-ui-primitives` from the shell's own module table at
 * runtime. This file exists for the gateway's server-rendered pages and the
 * landing page, which have no module table: one is Node writing HTML into a
 * string, the other is a static document. Neither can hold a React component.
 *
 * The version is not a parameter. It is read from `DSH_VERSION` in the
 * Dockerfile, which is the one place this deployment says which harness it
 * runs, and it is stamped into the output so the check can fail a version bump
 * that did not come back through here.
 *
 * Run: npm --prefix packages/dsh-icons run mirror
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { runInNewContext } from 'node:vm'

const here = import.meta.dirname
const root = resolve(here, '../..')

/** The harness icon package this table is generated from. */
const PACKAGE = '@deepseek-ai/dsh-client-ui-primitives'

/**
 * What the surfaces outside the shell ask for, as our name for the harness glyph.
 *
 * Deliberately short. A name added here is one more path that has to stay in
 * step with the generator; a plugin that can require the real component should
 * do that instead, and every one of them can.
 */
const WANTED = {
  light: 'IconLightOutlineMedium',
  dark: 'IconDarkOutlineMedium',
  'chevron-down': 'IconChevronDownOutlineMedium',
  'new-chat': 'IconNewChatOutlineMedium',
  'folder-close': 'IconFolderCloseMedium',
  // Both states, because the row it draws has both. The front door's picture of
  // the sidebar shows a workspace with its session listed under it — which is
  // an OPEN workspace — while the only folder here was the closed one, so the
  // picture disagreed with the product it is a picture of.
  'folder-open': 'IconFolderOpenMedium',
  // The source set draws this glyph against the left edge; this interface's
  // panel sits on the right, so the flip is done in the generated table
  // rather than at the call site.
  'panel-right': { name: 'IconPanelLeftOutlineMedium', flipX: true },
  plus: 'IconPlusOutlineMedium',
  send: 'IconSendOutlineMedium',
  copy: 'IconCopyOutlineMedium',
}

/** @returns {string} the harness version this deployment pins. */
const pinnedVersion = () => {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
  const match = dockerfile.match(/^ARG DSH_VERSION=(\S+)$/m)
  if (match === null) throw new Error('Dockerfile has no `ARG DSH_VERSION=` to read')
  return match[1]
}

/**
 * The published package's `lib/index.js`, fetched into a directory of its own.
 *
 * `npm pack` rather than an install: nothing here needs the dependency tree,
 * and adding the harness to a package.json would put a second pin beside the
 * Dockerfile's for the two to disagree about.
 *
 * @param {string} version - the version to fetch.
 * @returns {string} the module's source.
 */
const fetchLib = (version) => {
  const into = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
  execFileSync('npm', ['pack', `${PACKAGE}@${version}`, '--silent', '--pack-destination', into], { stdio: ['ignore', 'ignore', 'inherit'] })
  const tarball = readdirSync(into).find((name) => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error(`npm pack produced nothing for ${PACKAGE}@${version}`)
  execFileSync('tar', ['xzf', join(into, tarball), '-C', into])
  return readFileSync(join(into, 'package/lib/index.js'), 'utf8')
}

/**
 * One icon's geometry, read out of the published module.
 *
 * The published weight wrapper calls a shared artwork function. Render those
 * two pure functions and retain each path's own paint attributes: upstream
 * mixes strokes, fills and opacity within a single glyph. Unsupported nodes
 * or attributes fail generation instead of silently losing their artwork.
 *
 * @param {string} source - the module's source.
 * @param {string} name - the exported component's name.
 * @returns {{component: string, viewBox: string, paths: string[]}} the glyph.
 */
const readGlyph = (source, name) => {
  if (!source.slice(source.lastIndexOf('export {')).includes(`${name},`)) {
    throw new Error(`${PACKAGE} no longer exports ${name}`)
  }
  const declaration = (symbol) => {
    const start = source.indexOf(`const ${symbol} = `)
    if (start < 0) throw new Error(`missing icon declaration ${symbol}`)
    const next = source.slice(start + 1).search(/\n(?:const |var |let |function )/)
    return source.slice(start, next < 0 ? undefined : start + 1 + next)
  }
  const wrapper = declaration(name)
  const artwork = wrapper.match(/=> jsx\((\w+),/)?.[1]
  if (!artwork) throw new Error(`${name} is not an artwork wrapper`)
  // Evaluate only the selected, published pure artwork and its weight wrapper.
  // No imports, host APIs or package initialization run in this context.
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props }
  const tree = runInNewContext(
    `${declaration('ICON_MEDIUM_STROKE')}\n${declaration(artwork)}\n${wrapper}\n${name}({})`,
    { jsx, jsxs: jsx }, { timeout: 1000 },
  )
  if (tree.type !== 'svg') throw new Error(`${name} has no svg root`)
  const rootAllowed = new Set(['width', 'height', 'className', 'viewBox', 'fill', 'xmlns', 'aria-hidden', 'strokeWidth', 'children'])
  for (const key of Object.keys(tree.props)) {
    if (!rootAllowed.has(key)) throw new Error(`${name} carries unsupported root attribute ${key}`)
  }
  if (!/^0 0 \d+ \d+$/.test(tree.props.viewBox)) throw new Error(`${name} has no supported viewBox`)
  if (tree.props.fill !== 'none') throw new Error(`${name} carries an unsupported root fill`)
  const children = Array.isArray(tree.props.children) ? tree.props.children : [tree.props.children]
  const allowed = new Set(['d', 'fill', 'fillRule', 'clipRule', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'opacity', 'x', 'y', 'width', 'height', 'rx', 'ry'])
  const elements = children.map((child) => {
    if (!['path', 'rect'].includes(child.type)) throw new Error(`${name} contains ${child.type}; teach the mirror before shipping it`)
    for (const key of Object.keys(child.props)) {
      if (!allowed.has(key)) throw new Error(`${name} carries unsupported drawing attribute ${key}`)
    }
    const { d, ...attributes } = child.props
    if (child.type === 'path' && (typeof d !== 'string' || !d)) throw new Error(`${name} has no path data`)
    for (const colour of [attributes.fill, attributes.stroke]) {
      if (colour !== undefined && !['none', 'currentColor'].includes(colour)) throw new Error(`${name} carries a fixed colour`)
    }
    return { tag: child.type, attributes: { fill: tree.props.fill ?? 'none', strokeWidth: tree.props.strokeWidth, ...child.props } }
  })
  return { component: name, viewBox: tree.props.viewBox, paths: children.filter((child) => child.type === 'path').map((child) => child.props.d), elements }
}

const version = pinnedVersion()
const source = fetchLib(version)
/**
 * The transform that mirrors a glyph inside its own box.
 *
 * Recorded rather than applied to the coordinates: rewriting path data means
 * parsing every command, and an arc's flags do not survive a naive negation.
 * A transform is exact, and every consumer here already writes the element it
 * sits on.
 *
 * @param {string} viewBox - the glyph's box.
 * @returns {string} the transform.
 */
const mirrorAcross = (viewBox) => {
  const [minX, , width] = viewBox.split(/\s+/).map(Number)
  return `translate(${minX * 2 + width} 0) scale(-1 1)`
}

const glyphs = Object.fromEntries(Object.entries(WANTED).map(([key, wanted]) => {
  const { name, flipX } = typeof wanted === 'string' ? { name: wanted, flipX: false } : wanted
  const glyph = readGlyph(source, name)
  return [key, flipX === true ? { ...glyph, transform: mirrorAcross(glyph.viewBox) } : glyph]
}))

const body = Object.entries(glyphs).map(([key, glyph]) => `  /** Upstream's \`${glyph.component}\`. */
  ${JSON.stringify(key)}: {
    viewBox: ${JSON.stringify(glyph.viewBox)},
    paths: [
${glyph.paths.map((d) => `      ${JSON.stringify(d)},`).join('\n')}
    ],
    elements: ${JSON.stringify(glyph.elements)},${glyph.transform === undefined ? '' : `\n    transform: ${JSON.stringify(glyph.transform)},`}
  },`).join('\n')

writeFileSync(join(here, 'mirrored.js'), `/**
 * GENERATED by mirror.mjs — do not edit.
 *
 * These surfaces have no module table and cannot require the harness's React
 * icons, so this file exists to give them the path data. The version below
 * must equal DSH_VERSION. Attribution is in NOTICE.
 *
 * Regenerate with: npm --prefix packages/dsh-icons run mirror
 */

/** The harness version this table was generated against; must equal DSH_VERSION. */
export const MIRRORED_FROM = ${JSON.stringify(version)}

/** @type {Record<string, {viewBox: string, paths: string[]}>} */
export const mirrored = {
${body}
}
`)
process.stdout.write(`mirrored ${Object.keys(glyphs).length} glyphs from ${PACKAGE}@${version}\n`)
