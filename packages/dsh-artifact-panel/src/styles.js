/** Workspace content and the deployment's compact conversation header. */
import { NS, COMPACT_HEADER } from './constants.js'

export const CSS = `
  /* A layered display declaration yields to the shell's unlayered hidden
     state on blank conversations. All visible layout rules stay together. */
  @layer dsh-deployment-layout {
    ${COMPACT_HEADER} { display: grid; }
  }
  ${COMPACT_HEADER} {
    grid-template-columns: minmax(0, auto) auto minmax(0, 1fr) auto auto;
    align-items: center;
    column-gap: 10px;
    min-height: 0;
    padding-block: 8px;
    padding-inline: 20px 12px;
  }
  ${COMPACT_HEADER} > div:has(> [data-conversation-header-corner]) {
    display: contents;
  }
  ${COMPACT_HEADER} > div > div:has(> nav) {
    grid-area: 1 / 1;
    min-width: 0;
  }
  ${COMPACT_HEADER} > div > div:has(> [data-slot='conversation.session.header.utilities']) {
    grid-area: 1 / 4;
    margin-inline: 0;
  }
  ${COMPACT_HEADER} > div > [data-conversation-header-corner] {
    grid-area: 1 / 5;
    margin-inline: 0;
  }
  ${COMPACT_HEADER} > [role='tablist'] {
    grid-area: 1 / 2;
    align-items: center;
    gap: 2px;
    margin: 0;
    padding: 3px;
    border-radius: 10px;
    background: var(--dsw-alias-button-ghost-active-fill);
  }
  ${COMPACT_HEADER} > [role='tablist'] > [role='tab'] {
    padding: 5px 14px;
    border-radius: 8px;
    white-space: nowrap;
  }
  ${COMPACT_HEADER} > [role='tablist'] > [role='tab']::after,
  ${COMPACT_HEADER} > [role='tablist'] > [role='tab']::before {
    display: none;
  }
  ${COMPACT_HEADER} > [role='tablist'] > [aria-selected='true'] {
    background: var(--dsw-alias-bg-layer-1);
    box-shadow: var(--dsw-shadow-lv1);
  }
  @media (max-width: 600px) {
    ${COMPACT_HEADER} { column-gap: 6px; padding-inline: 8px; }
    ${COMPACT_HEADER} > [role='tablist'] > [role='tab'] { padding-inline: 8px; }
    ${COMPACT_HEADER} > div > div > div:has(> [data-slot='conversation.session.header.actions']) {
      flex-shrink: 1;
      min-width: 0;
      overflow: hidden;
    }
  }
  .${NS}-content { height:100%; min-height:0; min-width:0; display:flex; flex-direction:column; color:var(--dsw-alias-label-primary); }
  /* Shared content controls use the same round ghost geometry as DSH. */
  .${NS}-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    padding: 0;
    background: transparent;
    color: var(--dsw-alias-label-secondary);
    cursor: pointer;
  }
  .${NS}-icon-button:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }

  .${NS}-icon-button:focus-visible {
    outline: 2px solid currentColor; outline-offset: 2px;
  }
  /* Markdown carries its own type and spacing from the shell's own
     component; all this adds is the room around it. */
  .${NS}-markdown {
    padding: 14px 16px;
  }

  /* The code view fills the pane instead of sitting in it.
  
     The shell's CodeBlock draws a card — surface, border, radius, and a
     header carrying the language and a copy button. That is right inside a
     message, where a code block is one thing among many; it is wrong as a
     whole view, where it becomes a card drawn inside a pane that already
     has edges, with its own copy button competing with the row of actions
     above it. The highlighting is what we came for, so the card is undrawn
     and the copy moved up to the path row where the other actions are. */
  .${NS}-code {
    min-height: 100%;
  }
  .${NS}-code > * {
    height: 100%;
    margin: 0;
    border: none;
    border-radius: 0;
    background: transparent;
  }
  /* The card's header row: the language name and its own copy button. */
  .${NS}-code > * > *:first-child {
    display: none;
  }
  .${NS}-code pre {
    margin: 0;
    padding: 12px 14px;
    background: transparent;
  }

  /* The side column's own heading row, and the strip it folds into. */
  .${NS}-aside-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    height: 32px;
    padding: 0 6px 0 12px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--dsw-alias-border-l1);
  }
  .${NS}-aside-title {
    color: var(--dsw-alias-label-tertiary);
    font-family: var(--dsw-font-family);
    font-size: 12px;
  }
  /* The row menu and the questions it leads to. Both are drawn at the
     panel's level rather than inside the column a row lives in, so neither
     is clipped by that column's scrolling. */
  .${NS}-menu {
    position: fixed;
    z-index: 41;
    pointer-events: auto;
    min-width: 148px;
    padding: 4px;
    border-radius: 10px;
    background: var(--dsw-alias-button-elevated-fill);
    box-shadow: var(--dsw-shadow-lv2);
  }
  .${NS}-menu-item {
    display: block;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--dsw-alias-label-primary);
    font-family: var(--dsw-font-family);
    font-size: 13px;
    line-height: 18px;
    text-align: left;
    cursor: pointer;
  }
  .${NS}-menu-item:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .${NS}-menu-item[data-danger] {
    color: var(--dsw-alias-state-error-primary);
  }
  .${NS}-menu-item[data-danger]:hover {
    background: var(--dsw-alias-interactive-bg-hover-danger);
  }
  .${NS}-menu-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--dsw-alias-border-l1);
  }

  .${NS}-mask {
    position: fixed;
    inset: 0;
    z-index: 42;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--dsw-alias-bg-mask-1);
  }
  .${NS}-dialog {
    width: min(380px, calc(100vw - 32px));
    padding: 18px 20px 14px;
    border-radius: 14px;
    background: var(--dsw-alias-bg-layer-1);
    box-shadow: var(--dsw-shadow-lv3);
  }
  .${NS}-dialog-title {
    margin-bottom: 10px;
    color: var(--dsw-alias-label-primary);
    font-family: var(--dsw-font-family);
    font-size: 15px;
    font-weight: 500;
  }
  .${NS}-dialog-body {
    color: var(--dsw-alias-label-secondary);
    font-family: var(--dsw-font-family);
    font-size: 13px;
    line-height: 20px;
  }
  .${NS}-dialog-input {
    width: 100%;
    height: 34px;
    padding: 0 10px;
    box-sizing: border-box;
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 8px;
    background: transparent;
    color: var(--dsw-alias-label-primary);
    font-family: var(--dsw-font-family);
    font-size: 13px;
  }
  .${NS}-dialog-input:focus {
    outline: none;
    border-color: var(--dsw-alias-state-business-primary);
  }
  .${NS}-dialog-note {
    margin-top: 8px;
    color: var(--dsw-alias-label-tertiary);
    font-family: var(--dsw-font-family);
    font-size: 12px;
    line-height: 18px;
  }
  .${NS}-dialog-note[data-danger] {
    color: var(--dsw-alias-state-error-primary);
  }
  .${NS}-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  .${NS}-dialog-button {
    height: 32px;
    padding: 0 14px;
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 10px;
    background: transparent;
    color: var(--dsw-alias-label-primary);
    font-family: var(--dsw-font-family);
    font-size: 13px;
    cursor: pointer;
  }
  .${NS}-dialog-button:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .${NS}-dialog-button[data-primary] {
    border-color: transparent;
    background: var(--dsw-alias-button-primary-fill);
    color: var(--dsw-alias-label-primary-foreground);
  }
  .${NS}-dialog-button[data-primary][data-danger] {
    background: var(--dsw-alias-state-error-primary);
    /* White in BOTH themes, stated rather than inherited. The token
       label-primary-foreground is not "white": it is whatever contrasts
       with the PRIMARY fill, and that fill flips with the theme — so it is
       white in one and black in the other. The error fill does NOT flip;
       it is red either way. Inheriting the one from the other put black
       text on a red button, in whichever theme the primary button is
       light. */
    color: var(--dsw-static-neutral-bluish-00, #fff);
  }
  .${NS}-dialog-button:disabled {
    opacity: .55;
    cursor: default;
  }

  /* A file tab: the path and what can be done with it on one row, then
     the file beside the tree it was chosen from. */
  .${NS}-file {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .${NS}-file-menu { display: flex; flex-direction: column; }
  .${NS}-copy-status { font-size: 12px; color: var(--dsw-alias-label-secondary); }
  .${NS}-crumbs > .${NS}-copy-status {
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip-path: inset(50%); white-space: nowrap;
  }
  .${NS}-crumb:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
  .${NS}-crumbs {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: 36px;
    /* 12px on the right, the same as the bar above. The fold control here
       sits directly under the panel's own toggle, and 8 against 12 put
       their centres four pixels apart — close enough to read as a mistake
       rather than as two levels of one thing. */
    padding: 0 12px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--dsw-alias-border-l1);
  }
  /* The path, as places rather than as text. It scrolls rather than
     truncating: every level is a target, so hiding one would take away
     somewhere to go. */
  .${NS}-crumb-path {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    font-size: 12px;
    line-height: 18px;
    white-space: nowrap;
  }
  .${NS}-crumb-path::-webkit-scrollbar { display: none; }
  .${NS}-crumb {
    flex: none;
    padding: 2px 4px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--dsw-alias-label-tertiary);
    font-family: var(--dsw-font-family);
    font-size: 12px;
    line-height: 18px;
    cursor: pointer;
  }
  .${NS}-crumb:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
  .${NS}-crumb-sep {
    flex: none;
    color: var(--dsw-alias-label-tertiary);
  }
  .${NS}-crumb-name {
    flex: none;
    padding: 2px 4px;
    color: var(--dsw-alias-label-primary);
  }

  /* The two-position switch a markdown file gets. Segmented rather than a
     pair of buttons, for the same reason the host's own view switch is. */
  .${NS}-segments {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: none;
    height: 26px;
    padding: 2px;
    box-sizing: border-box;
    border-radius: 8px;
    background: var(--dsw-alias-button-ghost-active-fill);
  }
  .${NS}-segment {
    height: 22px;
    padding: 0 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--dsw-alias-label-secondary);
    font-family: var(--dsw-font-family);
    font-size: 12px;
    line-height: 22px;
    cursor: pointer;
  }
  .${NS}-segment[aria-pressed='true'] {
    background: var(--dsw-alias-bg-layer-1);
    color: var(--dsw-alias-label-primary);
    box-shadow: var(--dsw-shadow-lv1);
  }

  /* The file, and the tree it came from. The tree keeps its place when a
     file is opened — choosing one file is usually the prelude to choosing
     the next, and a tree that closes on every choice has to be reopened
     before every choice. */
  .${NS}-split {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
  }
  .${NS}-split-main {
    flex: 1 1 auto;
    min-width: 0;
    overflow: auto;
  }
  .${NS}-split-aside {
    display: flex;
    flex-direction: column;
    flex: none;
    width: 200px;
    min-height: 0;
    border-left: 1px solid var(--dsw-alias-border-l1);
  }

  /* Filtering, not searching: it narrows the rows already loaded rather
     than asking the sandbox to walk the workspace. The wording says so. */
  .${NS}-filter {
    flex: none;
    /* 12 on the right for the same reason as the bar above it: everything
       that ends at the panel's edge ends at the same place. */
    padding: 8px 12px 8px 8px;
    border-bottom: 1px solid var(--dsw-alias-border-l1);
  }
  .${NS}-filter input {
    width: 100%;
    height: 28px;
    padding: 0 10px;
    box-sizing: border-box;
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 8px;
    background: transparent;
    color: var(--dsw-alias-label-primary);
    font-family: var(--dsw-font-family);
    font-size: 12px;
  }
  .${NS}-filter input::placeholder {
    color: var(--dsw-alias-label-tertiary);
  }
  .${NS}-filter input:focus {
    outline: none;
    border-color: var(--dsw-alias-state-business-primary);
  }
  .${NS}-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  /* The tree. Rows are buttons so they answer to the keyboard without
     anything here reimplementing what a button already does. */
  .${NS}-tree {
    padding: 6px 0;
  }
  /* A row is a card with room around it, not a band across the column.
     Full-bleed selection reads as a highlight of the panel; an inset
     rounded rectangle reads as a selection of the thing. */
  .${NS}-row {
    display: flex;
    align-items: center;
    /* A little more air than the 6px this was: a mark and the name it
       belongs to should read as two things, and at 6px an icon and a
       lowercase letter of the same weight ran together into one shape. */
    gap: 8px;
    height: 28px;
    margin: 0 6px;
    padding-right: 6px;
    border-radius: 8px;
    box-sizing: border-box;
    border: none;
    background: transparent;
    color: var(--dsw-alias-label-primary);
    font-family: var(--dsw-font-family);
    font-size: 13px;
    line-height: 28px;
    text-align: left;
    cursor: pointer;
  }
  .${NS}-row:hover,
  .${NS}-row:focus-visible {
    background: var(--dsw-alias-interactive-bg-hover);
    outline: none;
  }
  .${NS}-row[aria-current='true'] {
    background: var(--dsw-alias-button-ghost-active-fill);
  }
  .${NS}-row-twisty {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 12px;
    color: var(--dsw-alias-label-tertiary);
    transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out);
  }
  .${NS}-row-icon {
    display: inline-flex;
    flex: none;
    color: var(--dsw-alias-label-tertiary);
  }
  .${NS}-row-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* Shown under the pointer, like the tabs' close key and for the same
     reason: a row that always carried two buttons would be a row of
     buttons with a name in it. */
  .${NS}-row-menu {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: none;
    opacity: 0;
  }
  .${NS}-row:hover .${NS}-row-menu,
  .${NS}-row-menu:focus-within {
    opacity: 1;
  }
  .${NS}-row-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--dsw-alias-label-tertiary);
    cursor: pointer;
  }
  .${NS}-row-action:hover {
    background: var(--dsw-alias-border-l2);
    color: var(--dsw-alias-label-primary);
  }
  /* Loading, empty and failed all read as one quiet line in the tree
     rather than as three different shapes. */
  .${NS}-tree-note {
    padding: 4px 10px;
    color: var(--dsw-alias-label-tertiary);
    font-size: 12px;
    line-height: 20px;
  }

  /* A file's own bytes, in the three shapes they come in. */
  .${NS}-text {
    margin: 0;
    padding: 12px 14px;
    color: var(--dsw-alias-label-primary);
    font-family: var(--dsw-font-family-code, ui-monospace, monospace);
    font-size: 12px;
    line-height: 20px;
    white-space: pre;
    /* The pane scrolls in both directions rather than wrapping: a wrapped
       line in a code file is a line that has moved. */
    overflow: auto;
  }
  .${NS}-media {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: 16px;
    box-sizing: border-box;
  }
  .${NS}-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .${NS}-frame {
    display: block;
    width: 100%;
    height: 100%;
    border: none;
    /* The previewed page paints its own background; without this a
       transparent one shows the panel through it. */
    background: #fff;
  }

  /* What is left when the panel's own render throws. It borrows the
     placeholder's shape rather than inventing one: this is the same
     moment — nothing to show, and a sentence saying why — and the only
     difference is that the reason is a defect rather than a wait. */
  .${NS}-crash {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 100%;
    padding: 24px;
    box-sizing: border-box;
    text-align: center;
    color: var(--dsw-alias-label-tertiary);
    font-size: 13px;
    line-height: 20px;
  }
  .${NS}-crash strong {
    color: var(--dsw-alias-state-error-primary);
    font-weight: 500;
  }

  /* Everything a body says when it has nothing to show yet: loading,
     empty, and failed alike. One look for all three, because to a person
     they are the same moment — the panel is not showing the thing asked
     for, and the sentence in the middle says why. */
  .${NS}-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 100%;
    padding: 24px;
    box-sizing: border-box;
    color: var(--dsw-alias-label-tertiary);
    font-size: 13px;
    line-height: 20px;
    text-align: center;
  }
`
