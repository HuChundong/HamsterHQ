/**
 * What the empty state and the `+` menu offer.
 *
 * @module tools
 */
/**
 * What the empty state offers.
 *
 * The four tools a tenant opens for themselves. This list is the active
 * half of the panel's one product rule — the passive half is files the
 * agent produced, which arrive by being clicked in the conversation and
 * are never listed here.
 */
export const TOOLS = [
  { id: 'files', icon: 'files' },
  { id: 'terminal', icon: 'terminal' },
  { id: 'canvas', icon: 'brush' },
  // The sandbox's own headless browser, watched. The canvas is the page the
  // agent is MAKING; this is the page it is READING — two subjects, two tabs.
  { id: 'browser', icon: 'window' },
]
