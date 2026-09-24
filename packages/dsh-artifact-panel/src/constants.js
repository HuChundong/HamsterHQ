/** Content identifiers. Geometry belongs to the upstream layout plugin. */
export const NS = 'dsh-artifact-panel'
export const ROOT = '/mnt/workspace'

// All compact-header rules share this structural guard. An upstream layout
// change makes the entire customization fall back together, without DOM moves.
export const COMPACT_HEADER = "header:has(> [data-slot='conversation.session.header'] > div > [data-conversation-header-corner]):has(> [data-slot='conversation.session.header'] > [role='tablist'] > [role='tab'])"
