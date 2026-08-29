/**
 * The panel's glyphs, from two sets, behind one name each.
 *
 * Almost all of them are the harness's own. `ui-primitives` carries 70 glyphs
 * drawn from the same source as the rest of the interface, and the panel sits
 * inside that interface — so a hand-drawn set beside it read as a second
 * product in the same window, which is what this replaced.
 *
 * The rest are in `dsh-icons`, and only because the harness set has no drawing
 * that means them: a terminal, the second half of the fullscreen pair, a plain
 * file, and the three file kinds the tree labels. They are drawn to the same
 * rules — a 16 grid, a 1.3 stroke expanded to a filled outline, `currentColor`,
 * no ink of their own.
 *
 * Both kinds render the same way through `icon()`, which is the point of going
 * through one table: a name that moves to the harness set later is a line in
 * the table and nothing at the call sites.
 *
 * @module icons
 */

import { extracted } from 'dsh-icons/extracted'
import { mirrored } from 'dsh-icons/mirrored'
import { h, primitives } from './runtime.js'

/**
 * Turn a control once, now.
 *
 * The attribute is taken off and put back with a forced reflow between,
 * because setting an attribute that is already there restarts nothing:
 * pressing refresh twice in a row would turn the glyph once. Reading
 * `offsetWidth` is what makes the removal land as its own style pass.
 *
 * @param {Element} button - the control that was pressed.
 */
export const turn = (button) => {
  button.removeAttribute('data-turning')
  void /** @type {HTMLElement} */ (button).offsetWidth
  button.setAttribute('data-turning', '')
}

/**
 * One inline icon, by name.
 *
 * `size` is a square edge in px. It overrides whatever a glyph's own drawn
 * size is, because these sit in rows whose height the panel decides.
 *
 * @param {string} name - a key of the glyph table.
 * @param {number} size - the square edge, in px.
 * @returns {object | undefined} the element, or nothing for a name the table does not carry.
 */
export const icon = (name, size = 16) => {
  const glyph = glyphs()[name]
  if (glyph === undefined) return undefined
  // A harness glyph is a component; ours is path data. The shell's set is
  // the one that can go missing — `primitives` is `{}` when the module
  // table does not carry it — and a missing icon must not take the render
  // down, so this answers with nothing rather than throwing.
  // On the glyph itself, not on a wrapper around it. A wrapper is one more
  // box in a row whose buttons size themselves from their contents, and it
  // is the kind of change that fails by making something disappear. Passed
  // as a style, so a component that does not forward props loses the flip
  // and keeps the icon — the failure worth having, of the two.
  if (typeof glyph === 'function') return h(glyph, { size })
  // Painted the way it was drawn. The harness's glyphs are outlines already
  // expanded to filled shapes; the extracted half is strokes, and filling a
  // stroke turns a drawing into a blot.
  const paint = glyph.stroke === undefined
    ? { fill: 'currentColor', fillRule: 'evenodd' }
    : {
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: glyph.stroke.width,
        strokeLinecap: glyph.stroke.linecap,
        strokeLinejoin: glyph.stroke.linejoin,
      }
  return h('svg', {
    width: size,
    height: size,
    viewBox: glyph.viewBox,
    fill: 'none',
    'aria-hidden': true,
  }, ...glyph.paths.map((d, at) => h('path', { key: at, d, transform: glyph.transform, ...paint })))
}

/**
 * Every glyph the panel draws, as the name the call sites use for it, built on
 * first use rather than at import.
 *
 * Where two names resolve to one glyph — `files` and `folder`, `browser` and
 * `html` — that is deliberate: the call sites mean different things and the
 * harness happens to draw them the same, which is a fact about the set rather
 * than something to collapse here.
 *
 * Half of these are the shell's own components, and the shell's module table
 * does not exist until `boot()` — which runs after every module in this bundle
 * has been evaluated. A table built at import time therefore reads `undefined`
 * for every one of them, and the failure is silent: `icon()` answers with
 * nothing, and a tab renders with an empty box where its mark should be, which
 * is what it did.
 *
 * @returns {object} name to glyph.
 */
/** The memo the table lands in. @type {object | undefined} */
let TABLE

const glyphs = () => (TABLE ??= {
  files: primitives.IconFolderClose16,
  // The globe, not `IconBrowseOutline16` — that one is a document with a
  // reading rule through it. An HTML file in the tree means "somewhere on
  // the web", which is what this draws. The canvas TAB used to wear it too
  // and now wears `brush`: a tool and a file that share one mark are two
  // things the eye has to tell apart by position.
  browser: primitives.IconGlobeOutline14,
  brush: extracted.brush,
  close: primitives.IconCloseOutline16,
  new: primitives.IconPlusOutline16,
  expand: primitives.IconFullscreenOutline16,
  panel: mirrored['panel-right'],
  chevron: primitives.IconChevronRightOutline14,
  more: primitives.IconEllipsisOutline16,
  code: extracted.code,
  copy: primitives.IconCopyOutline16,
  refresh: primitives.IconRefreshOutline16,
  terminal: extracted.terminal,
  // The browser-preview TAB: a window frame, not the globe — the globe
  // already marks an .html file in the tree, and a tool and a file sharing
  // one mark is what `brush` was introduced to end.
  window: extracted.window,
  // Session-header Computer control (and the tab it opens). laptop-minimal
  // from lucide — not `window`, which already means the Browser tab.
  computer: extracted.computer,
  shrink: extracted.shrink,
  file: extracted.file,
  image: extracted.image,
  markdown: extracted.markdown,
  'copy-text': extracted['copy-text'],
  data: extracted.data,
  archive: extracted.archive,
  table: extracted.table,
  media: extracted.media,
  aside: extracted.list,
})
