/**
 * The names and numbers this panel is built out of.
 *
 * Here rather than beside their first use because most of them are shared by
 * files that should not import each other: the stylesheet needs the class
 * prefix, the shell needs the layout variables, and the host-header surgery
 * needs both. A constant with two homes is a constant that drifts.
 *
 * @module constants
 */

/** Prefix every class this file writes, so nothing here can collide. */
export const NS = 'dsh-artifact-panel'

/**
 * The attribute the panel's root host carries.
 *
 * The anchor a skin or an outside stylesheet scopes to. CSS-module class
 * names in this app are content hashes and change between builds, so they
 * are not a contract; this is.
 */
export const ANCHOR = 'data-dsh-artifact-panel'

/** The layout variable `#root` gives up its margin to, in `px`. */
export const WIDTH_VAR = '--dsh-artifact-panel-width'

/**
 * The height of the host's session header, in `px`.
 *
 * The panel's tab bar matches it so the two rules across the top of the
 * window are one line rather than two that nearly agree. Measured rather
 * than restated: the header's height depends on the row merge below, on
 * whether a session exists at all, and on whatever upstream does to it
 * next. The fallback is what it measures today, for the moment before the
 * first measurement and for a deployment with no header to measure.
 */
export const HEADER_HEIGHT_VAR = '--dsh-artifact-panel-header-height'

/** Set on `body` while a drag is in flight, to suspend the transitions. */
export const DRAGGING = 'data-dsh-artifact-panel-dragging'

/**
 * Where the computer plugin renders the interactive desktop.
 *
 * The panel owns layout and tabs; dsh-computer owns the desktop and the
 * scheduled-task seat beneath it. The clients cannot import one another, so
 * the tree-side computer check keeps the duplicated name equal.
 */
export const COMPUTER_PANEL_ANCHOR = 'data-dsh-computer-panel'

/** DOM event the computer plugin dispatches when a handoff card is taken over. */
export const COMPUTER_OPEN_EVENT = 'dsh-computer:open'

/**
 * The session header, addressed by the slot it is rendered into.
 *
 * A slot name is a published contract where a class name is a build
 * artifact, so everything this file says about the host's own chrome is
 * anchored here.
 */
export const HEADER = '[data-slot=\'conversation.session.header\'] > header'

/**
 * The session header, but only while it is shaped the way the merge below
 * expects: a header whose second row holds ARIA tabs.
 *
 * Named once because it is one assumption, not eleven. Every rule that
 * rearranges upstream's header hangs off this guard, so if upstream moves
 * that row, renames it, or drops the roles, all of them stop matching
 * together and the header renders exactly as upstream draws it. A guard
 * repeated per rule could drift rule by rule and leave the header half
 * rearranged, which is the one failure this must not have.
 */
export const MERGED_HEADER = `${HEADER}:has(> div:nth-child(2) > [role='tab'])`

/**
 * Wide enough for two columns, because that is what the panel now is.
 *
 * 420 was right when a tab held one thing. With the tree keeping its place
 * beside the file, that left the file about 220px — narrow enough to wrap
 * a line of Python twice. The floor rises for the same reason: below this
 * the two panes stop being two panes.
 */
export const DEFAULT_WIDTH = 680

export const MIN_WIDTH = 480

/** Ceiling as a fraction of the window, so the conversation keeps a column. */
export const MAX_FRACTION = 0.6

/**
 * Where the workspace tree is rooted.
 *
 * Must agree with `ROOT` in the gateway's `panel-path.js`, which bounds
 * every path to it — two copies of one fact, because they are on opposite
 * sides of the wire and nothing can be imported across it.
 */
export const ROOT = '/mnt/workspace'
