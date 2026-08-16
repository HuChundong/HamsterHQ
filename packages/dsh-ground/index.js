/**
 * The lattice, as the gateway's pages need it: a `<script>` they can inline.
 *
 * Node only — it reads a file — which is why it is not what the landing page
 * imports. That side takes `dsh-ground/ground.js` directly and lets its
 * bundler do the inlining.
 *
 * Read once, at import, because it is the same bytes for every page and every
 * request. A file that cannot be read is a service that does not start, which
 * is the same rule the gateway's other assets follow: better than a page
 * served with a hole where its ground was.
 *
 * @module dsh-ground
 */

import { readFileSync } from 'node:fs'

/**
 * The source, without the header comment addressed to whoever maintains it.
 *
 * That comment is a page of prose about why this file exists in two shapes,
 * and it would be sent to every visitor of every page. The code's own inline
 * comments stay: they are short, and they explain the drawing to anyone who
 * opens the page source, which is a reasonable thing to do.
 */
const source = readFileSync(new URL('./ground.js', import.meta.url), 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n+/, '')

/**
 * The lattice as an inline script.
 *
 * No escaping happens here and none is needed. The pages interpolate this into
 * their own template literals as a value, and a value is not re-parsed — which
 * is the whole reason the source can be an ordinary file with ordinary
 * backticks in it.
 *
 * @type {string}
 */
export const GROUND_SCRIPT = `<script>\n${source}</script>`
