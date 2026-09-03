/**
 * Every rule this panel draws, as one stylesheet.
 *
 * A single template rather than styles beside their components, because it is
 * one cascade: the ordering between the tab strip, the tree, the dialogs and
 * the host-header surgery is part of what makes them agree, and splitting it
 * per component would hide that ordering in the import graph.
 *
 * Token-driven throughout: every colour is a `--dsw-alias-*` the theme declares
 * on `body`, so both schemes and every skin follow without this file knowing
 * any of them.
 *
 * @module styles
 */

import {
  DRAGGING,
  HEADER_HEIGHT_VAR,
  MERGED_HEADER,
  NS,
  WIDTH_VAR,
} from './constants.js'

/**
 * The panel's styles.
 *
 * Token-driven throughout: every colour is a `--dsw-alias-*` the theme
 * declares on `body`, so both schemes and every skin follow without this
 * file knowing any of them. The fallbacks after each token are for the
 * moment before the theme has applied, not for a theme that lacks it —
 * all of these were checked against a running deployment.
 *
 * One token is deliberately absent: `--dsw-specific-sidebar-fill`. It
 * belongs to the shell's left navigation column, and skins override it
 * with that meaning — one sets it to `transparent` — so a panel built on
 * it loses its fill. The general card surface is `--dsw-alias-bg-layer-1`.
 */
export const CSS = `
  .${NS}-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    /* The same surface the tenant's own sidebar paints, layered over ours
       rather than swapped for it.
       
       The two columns bracket the window and read as a pair, so they
       should be one colour — and the left one is painted with
       --dsw-specific-sidebar-fill, which this panel is warned off using:
       it belongs to the host's navigation column, and some skins set it to
       transparent, which would leave a panel built on it with no fill at
       all. A plain fallback cannot save that: transparent is a value and
       not an absence, so the second argument of var() is never reached.
       
       Layering answers both. The colour underneath is ours; the sidebar's
       fill is painted over it as a flat image. Where a skin gives that
       token a colour or a glass, the panel matches the sidebar exactly.
       Where a skin makes it transparent, what shows through is our own
       surface — which is what the panel looked like before. */
    background-color: var(--dsw-alias-bg-layer-1);
    background-image: linear-gradient(
      var(--dsw-specific-sidebar-fill, transparent),
      var(--dsw-specific-sidebar-fill, transparent)
    );
    border-left: 1px solid var(--dsw-alias-border-l1);
    color: var(--dsw-alias-label-primary);
    font-family: var(--dsw-font-family);
    /* Under the shell's own floating stack, which sits at 100 and above,
       so every dialog and popover of the app covers the panel rather than
       fighting it. */
    z-index: 40;
  }

  /* The drag target, straddling the panel's left edge. Wider than the
     border it grabs, because a 1px target is a target nobody hits. */
  .${NS}-grip {
    position: absolute;
    top: 0;
    left: -3px;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
    background: transparent;
    z-index: 1;
  }
  .${NS}-grip:hover,
  body[${DRAGGING}] .${NS}-grip {
    background: var(--dsw-alias-border-l2);
  }

  .${NS}-tabbar {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
    position: relative;
    /* Floored, and the floor is the point. This row holds the only controls
       that close or widen the panel, so it may never be shorter than they
       are — whatever the header it is matching happens to measure. Matching
       is a nicety; being reachable is not. */
    height: max(var(${HEADER_HEIGHT_VAR}, 49px), 40px);
    /* 12px on the right — the same inset the session header gives the very
       same button when the panel is closed, and the same the filter box
       below gets. This control moves between two containers as the panel
       opens and closes, so any disagreement between their right edges is a
       jump the eye reads as the button twitching. It was 12 there and 8
       here. */
    padding: 0 12px 0 6px;
    box-sizing: border-box;
    /* Transparent, and load-bearing: it reproduces the host header's box
       so the rule below lands on the same pixel row. */
    border-bottom: 1px solid transparent;
  }

  /* The rule across the top of the panel, drawn the way the host draws
     the one across the top of the conversation — as an absolutely placed
     1px bar inset from the bottom border, not as the border itself.
     
     Copying the recipe rather than approximating it is the point. The
     first version used \`border-bottom\` with the l1 token, which put the
     line two pixels lower and one shade lighter than the host's: two
     rules across the top of the window that almost agreed, which reads
     worse than either alone. The host's is \`header::after\` at
     \`bottom: 1px\` over l2, and with the tab bar already matching the
     header's measured height, the same recipe puts them on one line. */
  .${NS}-tabbar[data-empty]::after {
    display: none;
  }
  .${NS}-tabbar::after {
    content: '';
    position: absolute;
    right: 0;
    bottom: 1px;
    left: 0;
    z-index: 0;
    height: 1px;
    background: var(--dsw-alias-border-l2);
    pointer-events: none;
  }

  /* The tabs scroll; the trailing controls do not.

     The shrink-only flex and the zero min-width together are what keeps
     the last tab and the control that opens the next one whole: the strip
     shrinks and scrolls instead of pushing them out of the panel, and it
     sits against them rather than spanning the row. Without the zero
     min-width a flex item refuses to shrink below its content, and the row
     overflows with the plus beyond the panel's edge. */
  .${NS}-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 0 1 auto;
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    /* Deliberately NOT smooth. Smooth turns an assignment to the scroll
       offset into an animation, so the value read back is the one it
       started from and any re-render before it lands cancels it — which is
       how a strip that had been told to show the new tab kept showing the
       old one. */
    scrollbar-width: none;
  }
  .${NS}-tabs::-webkit-scrollbar { display: none; }

  /* A tab is as wide as its own name, up to a ceiling.

     Not one width for all of them, and not a width the row divides among
     them. Both were tried here and both make a tab's width a function of
     the OTHER tabs: under the shared-width rule, opening a seventh file
     moved the six already open — every one of them narrowed, so the tab
     somebody was about to click was no longer where they were looking. A
     width that follows the name is stable under everything except renaming
     the file, and the row is read left to right rather than measured.

     The ceiling is what keeps one long name from taking the row: past
     132px the name fades out (see the label below) instead of pushing its
     neighbours off the end. There is no floor. A short name gets a short
     tab, which is the whole of this rule, and the label's own right-hand
     padding is what stops the close key landing on the last letter of one.

     Past the row's width the strip scrolls — by wheel, by drag, and by
     itself when the tab in play is off the end. Scrolling is the honest
     answer to more tabs than fit: it hides some of them completely, which
     is at least visible, while narrowing hides a piece of every name at
     once and reads as though nothing was lost. */
  .${NS}-tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    max-width: 132px;
    height: 30px;
    padding: 0 8px;
    box-sizing: border-box;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--dsw-alias-label-secondary);
    font-family: var(--dsw-font-family);
    font-size: 13px;
    line-height: 20px;
    cursor: pointer;
    white-space: nowrap;
  }
  .${NS}-tab:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
  /* The showing tab, told apart by its ground.

     Same token as every other durable "this is selected" surface in the
     panel — the tree row, the segment track, the fold that is on —
     \`--dsw-alias-button-ghost-active-fill\`. Measured on the light skin:
     panel \`#fbfbfa\`, this fill \`#f0eeec\`; on dark: panel \`#232324\`,
     fill \`#43454a\`. Both are opaque steps the eye can hold.

     \`interactive-bg-active\` was tried first. It is a translucent press
     tint (\`#2631481a\` light / \`#ffffff24\` dark) meant for a finger-down
     moment, and stacked with \`border-l2\` it still read as the same wash
     as hover — the open tab and the hovered neighbour were one colour.
     Docs/artifact-panel.md names ghost-active-fill as the verified
     pressed token; use it, and do not invent a second selected look.

     Ground and label colour only. A heavier weight was dropped once a
     tab took its width from its name: 500 measures wider than 400, so
     selecting twitched the whole strip. */
  .${NS}-tab[aria-selected='true'] {
    background: var(--dsw-alias-button-ghost-active-fill);
    color: var(--dsw-alias-label-primary);
  }
  /* Pushes the closing control to the panel's own edge. */
  .${NS}-spacer {
    flex: 1 1 auto;
  }
  .${NS}-tab-icon {
    display: inline-flex;
    flex: none;
    color: var(--dsw-alias-label-tertiary);
  }
  .${NS}-tab[aria-selected='true'] .${NS}-tab-icon {
    color: var(--dsw-alias-label-primary);
  }
  /* A name that does not fit fades out; it is not cut with an ellipsis.

     An ellipsis costs three characters to say "there is more", and at the
     widths this row reaches that is most of the name — \`m…\` says nothing
     at all, while three more letters of \`main.py\` often say everything.
     The fade carries the same "there is more" for free, and it is honest
     about it: the reader sees the letters running out rather than a mark
     standing in for them.

     Masked rather than drawn as a gradient over the top, because a
     gradient would need to know the ground it sits on — and the ground
     here is three different colours (idle, hovered, showing) over two
     themes. A mask makes the TEXT transparent instead, so whatever is
     behind it shows through unchanged.

     The mask is on the box, not on the text, so a name shorter than its
     box is untouched: the fade lands where there is nothing to fade. */
  .${NS}-tab-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    /* The gutter is what makes one fade correct for both cases, with no
       measuring and no second rule for the pointer.

       A name that fits ends 14px before the box does, so the fade has only
       empty ground to work on and the name is drawn whole — and that same
       14px is where the close key sits, so it appears over the gutter
       rather than over the last letter. A name that does not fit is
       scrolled under its own gutter: the padding goes past the clipping
       edge, the letters reach the fade, and the tail dissolves exactly
       where the key will be. */
    padding-right: 14px;
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent);
  }

  /* The close key appears under the pointer rather than on the selected
     tab, and it is LAID OVER the name rather than given a column of its
     own.

     Its own column was 16px and it held them whether or not anything was
     drawn in it — on a short tab, most of the room the name had, spent on
     empty space for the tab the pointer is not on. Out of the flow it
     costs nothing until it is wanted, and it lands on the label's gutter:
     empty ground when the name fits, and the tail the fade has already
     given up when it does not.

     Opaque solid fills only — layered translucent tints collapsed into
     the panel surface in light mode and left the glyph floating on the
     name. \`interactive-bg-hover-solid\` is the theme's opaque hover chip;
     on the selected tab the panel surface itself sits on ghost-active-
     fill as a lighter (light) / darker (dark) chip. */
  .${NS}-tab-close {
    position: absolute;
    top: 50%;
    right: 6px;
    margin-top: -8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    opacity: 0;
    border: none;
    border-radius: 4px;
    padding: 0;
    background: var(--dsw-alias-interactive-bg-hover-solid);
    color: var(--dsw-alias-label-secondary);
    cursor: pointer;
  }
  .${NS}-tab[aria-selected='true'] .${NS}-tab-close {
    background: var(--dsw-alias-bg-layer-1);
    color: var(--dsw-alias-label-secondary);
  }
  .${NS}-tab:hover .${NS}-tab-close,
  .${NS}-tab-close:focus-visible {
    opacity: 1;
  }
  /* Under the pointer: step away from the chip's resting fill. Unselected
     uses ghost-active-hover (darker wash); on the selected tab that token
     is almost the selected ground itself in light mode, so the opaque
     hover-solid lifts the chip off ghost-active-fill instead. */
  .${NS}-tab .${NS}-tab-close:hover {
    background: var(--dsw-alias-button-ghost-active-hover);
    color: var(--dsw-alias-label-primary);
  }
  .${NS}-tab[aria-selected='true'] .${NS}-tab-close:hover {
    background: var(--dsw-alias-interactive-bg-hover-solid);
    color: var(--dsw-alias-label-primary);
  }

  /* A control that asks for something again, turning once as it asks.

     Half a second and one turn, on the gesture rather than on the work:
     what these two buttons start — a directory listing, an iframe's own
     fetch — usually settles faster than the eye can register a spinner
     appearing and going, and tying the turn to the work would mean the
     common case is a flicker. The turn is the acknowledgement; the result
     arriving is its own answer.

     On the glyph, not on the button: the button is a hover target with a
     ground, and turning that turns the ground with it. */
  @keyframes ${NS}-turn {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .${NS}-icon-button[data-turning] > * {
    animation: ${NS}-turn 500ms var(--ds-ease-in-out, ease-in-out);
  }
  @media (prefers-reduced-motion: reduce) {
    .${NS}-icon-button[data-turning] > * { animation: none; }
  }

  /* The shell draws an icon control as a round ghost, and the panel's sit
     in the same rows as the shell's. A squarer corner here read as a
     different kind of control rather than the same one. */
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

  .${NS}-body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
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

  /* The empty state. The panel opens with no tabs, so this is the first
     thing anyone sees — it lists what can be opened rather than showing a
     blank surface with a `+` somewhere in a corner. */
  /* Nothing but the cards, centred in the panel.
     
     The row above them said "Open a tool" over three cards that are each
     a tool with its name on it — a caption for a picture of itself. What
     is left is the choice, and with the caption gone there is no reading
     order to anchor to the left edge: the cards centre, in both axes, in
     the space the panel is not otherwise using. */
  .${NS}-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
    box-sizing: border-box;
  }
  /* Two cards to a row, each the size of what is in it.

     Two columns stated rather than a floor that fits as many as it can:
     the panel is a column beside a conversation, and a row of three across
     it read as a toolbar rather than as a choice between three things. The
     columns are a width, not a fraction, so the cards stay the size the
     content wants at every panel width instead of stretching into
     whatever room the panel happens to have — a 400px-wide card holding an
     icon and one word is a card that has lost track of what it is for.

     Centred, which is where a choice with no caption over it belongs —
     and because the cards are a width rather than a fraction, centring
     moves them as a block instead of growing each one to swallow the
     space. */
  /* Two fixed columns, and the pair of them centred in the panel.
     
     Centring the BLOCK, not each line: a wrapped flex row centres its last
     line too, which put a third card under the middle of the two above it
     — a little pyramid, and a reading order that starts in a different
     place on every row. A grid seats the odd card in the first column, so
     the left edge of the group is a line all the way down. */
  .${NS}-choices {
    display: grid;
    grid-template-columns: repeat(2, 124px);
    justify-content: center;
    gap: 8px;
  }
  /* Two rows, centred on each other: the mark, then the name. The
     sentence that used to sit under the name has moved to the card's
     title — three lines of prose in a card the size of a stamp is a
     paragraph with a border, and what the tool does is answered by
     opening it. */
  .${NS}-choice {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 124px;
    gap: 8px;
    /* Deeper above and below than to either side. The card is two short
       rows stacked, and even padding around them reads as a label with a
       box drawn tight to it; the air is what makes it a card. */
    padding: 18px 12px;
    box-sizing: border-box;
    border: 1px solid var(--dsw-alias-border-l1);
    border-radius: 10px;
    background: transparent;
    color: var(--dsw-alias-label-primary);
    font-family: var(--dsw-font-family);
    font-size: 13px;
    line-height: 20px;
    text-align: center;
    cursor: pointer;
  }
  .${NS}-choice:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    border-color: var(--dsw-alias-border-l2);
  }
  .${NS}-choice-icon {
    display: inline-flex;
    flex: none;
    color: var(--dsw-alias-label-secondary);
  }
  .${NS}-choice-note {
    color: var(--dsw-alias-label-tertiary);
    font-size: 11px;
    line-height: 16px;
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
  /* One shell's screen. All of them are laid out; only one is shown. */
  .${NS}-console-slot {
    height: 100%;
  }

  /* The terminal fills its tab; xterm draws inside it. */
  .${NS}-console {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 8px 0 0 10px;
    box-sizing: border-box;
    background: var(--dsw-alias-bg-layer-1);
  }
  .${NS}-console-screen {
    flex: 1 1 auto;
    min-height: 0;
  }
  .${NS}-console-note {
    flex: none;
    padding: 8px 10px;
    color: var(--dsw-alias-label-tertiary);
    font-family: var(--dsw-font-family);
    font-size: 12px;
  }

  /* The browser preview: one frame, letterboxed rather than cropped. The
     frame keeps the page's own aspect, so a panel narrower than the page
     shows all of it smaller instead of a corner of it actual-size. */
  .${NS}-shot-box {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    height: 100%;
    overflow: auto;
    padding: 10px;
    box-sizing: border-box;
    background: var(--dsw-alias-bg-layer-1);
  }
  .${NS}-shot {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    border: 1px solid var(--dsw-alias-border-l1);
  }

  /* The row menu and the questions it leads to. Both are drawn at the
     panel's level rather than inside the column a row lives in, so neither
     is clipped by that column's scrolling. */
  .${NS}-menu {
    position: fixed;
    z-index: 41;
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
  /* A menu row that carries a mark, for the menu the `+` opens: the same
     row as the tree's, plus the icon that names the tool in the tab bar —
     two ways of saying the same tool, so the menu and the tab it produces
     look like each other.

     Stated as a compound selector and placed AFTER the plain row, both on
     purpose. A row is \`display: block\` and this one has to be a flex
     line; at equal specificity the later rule wins, so written above with
     one class it lost its display to the very rule it was extending —
     the icon and the name ran together on the baseline with no gap and no
     centring, which is exactly what a block box does with two inline
     children. */
  .${NS}-menu-item.${NS}-menu-tool {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .${NS}-menu-tool > span:first-child {
    display: inline-flex;
    flex: none;
    align-items: center;
    color: var(--dsw-alias-label-tertiary);
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

  /* The header's utility buttons, given one shape — the rail's.
  
     There were three shapes in this row at once: the sidebar's New session
     button, Session log as a wide pill with a label, and ours as a third
     thing again. What settles it is that both of these are now icons: a
     word on one of two adjacent icon buttons is the odd thing in the row,
     and once the word goes there is nothing left for a pill to hold. So
     both take the shape of the collapse control at the other end of the
     window — a 28px circular ghost, no border, no fill until the pointer
     arrives. The sidebar's class is a content hash, not a contract, so this
     rule is expressed in tokens and anchored on the slot.
     
     The rule is anchored on the slot both are rendered into, so it styles
     what that seat holds rather than reaching into a component: a Session
     log that moves or goes away takes its own look with it and nothing
     here is left pointing at a hole. */
  [data-slot='conversation.session.header.utilities'] button,
  .${NS}-opener,
  .${NS}-toggle,
  .${NS}-computer-launch {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    min-width: 0;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--dsw-alias-label-secondary);
    cursor: pointer;
  }
  [data-slot='conversation.session.header.utilities'] button:hover,
  .${NS}-opener:hover,
  .${NS}-toggle:hover,
  .${NS}-computer-launch:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
  /* Session log's own label. Hidden rather than removed: it is upstream's
     element and upstream's copy, and it is still what a screen reader
     reads out, which display:none or visibility:hidden would take away. */
  [data-slot='conversation.session.header.utilities'] button > span:first-child {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* Pressed is a state of the control, not a second control: the same
     button says the panel is open rather than turning into a different
     one. */
  .${NS}-toggle[aria-pressed='true'],
  .${NS}-computer-launch[aria-pressed='true'] {
    background: var(--dsw-alias-interactive-bg-active);
    color: var(--dsw-alias-label-primary);
  }

  /* The stand-in for the toggle before a session exists, when there is no
     header to sit in. The corner is empty in that state; once a session
     opens this is not rendered at all, so it can never overlap the
     header's own controls.
     
     It carries no look of its own — it is in the rule above, alongside the
     control it stands in for, and everything here is about WHERE it sits.
     It used to be a 32px bordered rectangle while the control it replaces
     is a 28px circle, so opening the panel moved the button two pixels
     left and two pixels up and changed its shape on the way. It is one
     control in a person's hands, and the eye reads the difference as the
     button jumping rather than as two buttons. */
  .${NS}-opener {
    position: fixed;
    /* Level with the panel header's own row, so the button does not rise
       or fall as the panel opens under it. */
    top: 10px;
    /* Clear of the panel when it is open, which is why the width is a
       variable on the document rather than a number in the component. */
    right: calc(var(${WIDTH_VAR}, 0px) + 12px);
    transition: right var(--ds-transition-duration-slow) var(--ds-ease-in-out);
    z-index: 40;
  }
  .${NS}-opener[aria-pressed='true'] {
    color: var(--dsw-alias-label-primary);
  }
  body[${DRAGGING}] .${NS}-opener {
    transition: none;
  }

  /* ---- the host's own header, rearranged -------------------------------
     A different kind of work from everything above: this is surgery on a
     component we do not own, so it is written to fail by doing nothing.

     Every rule hangs off \`MERGED_HEADER\`, whose guard describes the
     structure it expects; see it for what happens when upstream's does not
     match. Nothing here can leave a button orphaned or stacked on another.

     No class names are involved. They are content hashes and change
     between builds; \`role="tab"\` and \`aria-selected\` are the contract
     the component already publishes, and they say precisely what is
     needed.

     What it does: the view switch stops occupying a row of its own and
     joins the title row as a segmented control, which is what gives that
     vertical space back to the conversation. */
  ${MERGED_HEADER} {
    display: grid;
    /* The switch belongs beside what it switches, so it sits directly
       after the title cluster and the free space falls between it and the
       utilities — rather than the title taking the slack and pushing the
       switch across the window. */
    grid-template-columns: minmax(0, auto) auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 12px;
    /* Upstream pads 12px above the title row and leaves the bottom to the
       row that has now gone. With one row instead of two the header was
       still carrying two rows' worth of air, so both edges come in — this
       is the whole of the height the merge was for. */
    padding-top: 8px;
    padding-bottom: 8px;
    /* Upstream insets the right edge 28px, sized for the bordered pill
       that used to end the row. The row now ends in a 28px ghost circle,
       which carries far less visual weight and read as marooned that far
       in — the same inset that framed a pill strands a circle. */
    padding-right: 12px;
  }

  /* Dissolved, not moved: \`display: contents\` lets the title row's two
     clusters become items of the header's grid so the switch can sit
     between them. The row carries no padding of its own — the header
     does — so nothing is lost with the box. */
  ${MERGED_HEADER} > div:first-child {
    display: contents;
  }
  ${MERGED_HEADER} > div:first-child > div:first-child {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
  }
  ${MERGED_HEADER} > div:first-child > div:nth-child(2) {
    grid-column: 4;
    grid-row: 1;
  }

  ${MERGED_HEADER} > div:nth-child(2) {
    /* Row stated as well as column: with only the column pinned, grid's
       sparse auto-placement finds the cursor already past column 2 and
       drops the switch onto a second row — the exact row this block
       exists to remove. */
    grid-column: 2;
    grid-row: 1;
    gap: 2px;
    height: 32px;
    margin: 0;
    padding: 3px;
    box-sizing: border-box;
    border-radius: 10px;
    background: var(--dsw-alias-button-ghost-active-fill);
    align-items: center;
  }
  /* Shape only. The switch's own type and colours — tertiary when idle,
     the business accent when active — are upstream's and stay upstream's;
     restating them here would be a second copy to keep true. */
  ${MERGED_HEADER} > div:nth-child(2) > [role='tab'] {
    height: 26px;
    padding: 0 14px;
    border-radius: 8px;
    line-height: 26px;
  }
  /* Whatever upstream draws under the active tab belongs to the row it no
     longer sits in. */
  ${MERGED_HEADER} > div:nth-child(2) > [role='tab']::after,
  ${MERGED_HEADER} > div:nth-child(2) > [role='tab']::before {
    display: none;
  }
  ${MERGED_HEADER}
    > div:nth-child(2) > [role='tab'][aria-selected='true'] {
    background: var(--dsw-alias-bg-layer-1);
    box-shadow: var(--dsw-shadow-lv1);
  }

  /* The push: the conversation gives up the width instead of being
     covered.

     Taken off the CENTRE COLUMN, not off #root, and that is not a detail.
     The app frame watches ITS OWN box with a ResizeObserver and collapses
     the left sidebar below 1024px — so narrowing #root told the app the
     window had shrunk, and opening this panel folded the tenant's sidebar
     away. Nothing about the window changed; only our panel appeared.

     Shrinking the centre column instead leaves the frame the width it
     always had, so that decision is never disturbed, and the squeeze still
     lands where it should: the centre column is the only flexible one, so
     the conversation and its composer reflow and the sidebar does not
     move. The strip the column gives up is what the panel is drawn over.

     A margin works here where it could not on #root: this is a grid item,
     and a grid item shrinks by its margins. #root is a block at full
     width, where a right margin over-constrains the box and CSS resolves
     that by ignoring the margin outright.

     If upstream ever restructures the frame this selector stops matching,
     and the panel goes back to covering the conversation instead of
     pushing it — worse to look at, and nothing breaks. */
  html #root > [data-slot='root'] > div > div:nth-child(2) {
    margin-right: var(${WIDTH_VAR}, 0px);
    transition: margin-right var(--ds-transition-duration-slow) var(--ds-ease-in-out);
  }
  body[${DRAGGING}] #root > [data-slot='root'] > div > div:nth-child(2) {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    html #root > [data-slot='root'] > div > div:nth-child(2) { transition: none; }
  }
`
