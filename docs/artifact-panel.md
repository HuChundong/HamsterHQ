# Workspace tools and previews

[中文](artifact-panel.zh.md)

`packages/dsh-artifact-panel` contributes content to DSH's right sidebar. DSH owns the frame, navigation, tab strip, resizing and context lifetime. The deployment supplies enhanced Files and Canvas; DSH supplies Browser and Terminal. The left Cloud computer entry opens its right-sidebar tab beside the current conversation; scheduled tasks also retain their global page.

## Navigation and ownership

Each content type registers with `ctx.sidebarRightTabs`, and its component fills `sidebar.right.pane.tab` under the same type identifier. The guide exposes the workspace tools and Computer. There is no deployment-owned body-level panel, margin adjustment on the conversation or duplicate tab store.

The conversation header retains the deployment's single-row design: title, conversation/trace switch, then trailing actions. CSS uses the published header slot and semantic children, without moving DOM nodes or replacing upstream controls. One shared structural guard makes the styling fall back together if that structure changes; a cascade layer preserves the shell's hidden header on blank conversations. `verify/verify-sidebar.mjs` checks alignment, narrow widths and switching.

DSH owns context selection, resource navigation and tab closure. Components read their current tab through `useTabInfo`; Files calls `tab.actions.openResource` with the official workspace-file address helper. Opening a file therefore uses the same navigation as upstream file links and deliverables. The plugin no longer replaces `remote.session.openWorkspacePath`.

Computer and scheduled tasks register footer actions above sandbox status. Computer's main key is only a navigation request: a root controller returns to the conversation and opens its right tab after the session seat mounts. With no selected session, it waits for session selection. Scheduled tasks retains its main page. The account menu replaces `settings.trigger` in the bottom control, with Settings inside that menu; sandbox status remains in the footer and opens the Sandbox settings section when activated. Upstream keeps the Settings modal state private, so one adapter intercepts the trigger's click to open the account menu and permits its original click for the menu's Settings action or the sandbox shortcut. The shortcut selects the section by its stable marker after the modal mounts. Its always-mounted component continues to supply the environment-variable and restart controls in the sandbox settings page.

## Files and previews

Files owns its directory tree and viewers, using the gateway's envd-backed file routes. Each file opens in a DSH resource tab with its preview and collapsible directory tree together. The plugin reads text and images through `/sandbox/raw/*`, and HTML through the existing ticketed preview channel so relative assets resolve. PDF uses the browser's embedded viewer; unsupported binaries offer a download. Markdown retains source/preview switching.

The type claims standard session file addresses at the extension priority. Main-conversation file links and deliverable actions therefore open the same owned file surface through DSH's public resource navigation; no Remote method is replaced. The official shell still owns outer tabs, resizing and session selection.

Breadcrumbs reveal directories, the selected file is highlighted, and copy actions read the complete authenticated file. The workspace watcher directly refreshes owned viewers and the tree. File deletion closes matching resource tabs through their tab-owned actions. There is no DOM activation adapter for another previewer's reload control.

The tree uses the authenticated gateway file routes. The gateway talks to envd through its official client, using CubeProxy's path routing. The artifact plugin has an inert host entry so the module registry loads its browser half; it adds no file RPC server inside the sandbox.

Gateway file routes accept any absolute path in the caller's sandbox. `/mnt/workspace` is the Files tree's browsing root; it is not an API restriction on file links opened elsewhere. Tenant isolation comes from authenticating the caller and resolving that caller's sandbox. Symlinks are not an additional tenant boundary. See [the design](design.md) for the deployment and model planes.

## Terminal lifetime

DSH owns the terminal renderer, PTY and session lifetime. Its built-in terminal uses the authenticated DSH API and remote mux carried by the gateway tunnel. Reconnecting can recover the running process and its screen; closing a terminal tab ends its process. Terminals belong to the current DSH session.

The artifact plugin registers neither a terminal type nor a separate renderer. The gateway's independent envd terminal remains on the recovery page so a tenant can repair a sandbox when DSH cannot start.

## Canvas and browser

Canvas remains a ticketed HTML surface, separate from upstream document previews. It follows the newest HTML page using the workspace watcher and refreshes when relevant files change. Opening Canvas expresses the user's intent to follow that output; producing a file does not open another tab automatically.

The preview uses path-encoded URLs so relative assets resolve alongside the document. Its iframe and response CSP omit `allow-same-origin`, giving the document an opaque origin. The short-lived ticket authorizes the preview without handing the sandbox page the tenant's normal session credentials. The gateway's preview routes remain the authority for expiry and response headers.

DSH's built-in Browser owns ordinary webpage tabs. It displays an iframe in the user's browser; it does not share the sandbox Chromium session. The artifact plugin has no browser registration or screenshot polling. Watching and taking over the sandbox browser belongs to Cloud computer.

## Cloud computer and human takeover

`dsh-computer` renders its desktop in the official right sidebar, including when opened from the left Cloud computer entry. The right-side desktop is a preview: hover or keyboard focus reveals Open, and activating the whole area opens noVNC in a new window. Below it, the declared `computer.schedule` slot shows a compact task list with a plus action. A task opens a secondary detail page over the sidebar; the desktop frame stays mounted with unchanged geometry underneath, and Back restores the list. The independent schedule page uses the same list and detail controls. The compact editor keeps Back, enablement, Delete and Save in a fixed toolbar while only the fields scroll. Buttons and switches use the published UI primitives; failed mutations keep the editor and its state available for retry. Both left footer entries toggle their surfaces. In fullscreen, tasks and the launch overlay are hidden and the same noVNC frame accepts input directly; restoring the sidebar returns to preview mode. Scheduled tasks also retains its global manager.

The human-action card and full-window takeover remain owned by `dsh-computer`. `computer_request_user_action` uses DSH's public user-question flow for completion and skipping; takeover itself does not resolve the wait. Its `DesktopFrame` follows noVNC readiness, errors and reconnects. The same noVNC page can be opened in a new window.

## Verification and package boundaries

`scripts/check-computer-layout.mjs` checks the deployment's navigation contracts; `scripts/check-computer-loading.mjs` covers noVNC readiness and bootstrap. `scripts/check-icons.mjs` keeps source-only clients' inline glyphs equal to the generated originals. Tree checks do not establish runtime compatibility with a new harness version: rebuild the images, run image checks and complete the acceptance suite against a disposable deployment as required by [AGENTS.md](../AGENTS.md).

The artifact package bundles its extra runtime dependencies, while React comes from DSH's module table. Other source-only browser plugins cannot import sibling packages. Content uses the shell's theme tokens and `ctx.locale`; geometry and context state stay with DSH.
