# The artifact panel

[中文](artifact-panel.zh.md)

`packages/dsh-artifact-panel` is a browser-only dsh plugin: it mounts a panel down the right of the conversation window, where a tenant opens tools and looks at what their agent produced. This page says what it is, why it has this shape, and which platform facts building it forced into the open.

## In one sentence

**A tab holds one of two things: a tool the user opens, or a result the agent produced.**

That sentence is the test for the tab strip. Anything that wants to become a tab is asked which of the two it is; something that is neither does not become a peer tab. Supporting controls may sit inside the surface they govern — the schedule manager under Computer is one — without turning into another workbench tab.

## The organising rule: active and passive

Tabs are sorted by **where they come from**, and that division is the skeleton of the whole thing.

**Active** — tools the user reaches for, which stay: Files, Terminal, Canvas, Browser, and Computer from the session header.

**Passive** — what the agent produced during the session, which the user looks at: previews of produced files (markdown, code, images, HTML).

The usual failure mode in this category is making every panel a **peer tab**: a file tree, a terminal, Git, sub-agents and an editor side by side in one strip, with no principle saying who belongs there. Once they are peers, there is no reason to refuse the next one, and the panel grows into a workbench.

The active/passive split is the reason to refuse: **a new tab is either a tool a user opens or a result an agent produces; something that is neither does not go in this panel.**

### Deliberately not here

| Not here | Why |
|---|---|
| A Git panel | Neither tool nor artifact — it is session narrative, and that lives on the left |
| Sub-agent topology or generic background jobs as peer tabs | Same; Computer's schedule manager is a control for that surface, not another tab |
| Bottom panels, split panes, merged panels | A layout system grows into an IDE, and brings its own persistence and stale-state cleanup |
| File editing | The editor is the agent; saying what to change is faster than opening one |
| Office and PDF preview | Heavy dependencies for little return, until somebody actually needs it |

## The tab strip

**Every tab can be opened and closed, Files included.** Active and passive is a **test for what may enter**, not a difference in how tabs behave; there is no such thing as a pinned tab here.

- **A tab is as wide as its own name**, up to 132px. A shared width and a shrink-to-fit width were both tried, and both make one tab's width a function of the **other** tabs: opening a seventh file narrows the six already open, and the tab somebody was about to click is no longer where they were looking.
- A name that does not fit **fades out** rather than ending in an ellipsis: an ellipsis spends three characters saying "there is more", and at these widths three characters are most of the name. The fade is a mask on the text — not a gradient painted over it — because the ground underneath is three colours (idle, hovered, showing) across two themes.
- **The close key is laid over the name**, not given a column: it appears under the pointer, over the label's own 14px gutter, so it costs no width on the tabs the pointer is not on.
- When the row runs out, it **scrolls sideways**: by wheel (a native listener with `passive: false` — React registers `onWheel` as passive, where `preventDefault` only logs a warning), by drag, and by itself when the tab in play is off the end.
- **Middle click closes**, as it does everywhere else tabs exist.
- **Deduplicated by path**: a file produced repeatedly occupies one tab.
- **Nothing is evicted**: tabs accumulate and the user closes them.

The showing tab is told apart **by its ground alone** — no ring, no heavier weight. Measured: the old fill was 1.12:1 against the panel's surface and 1.005:1 against the **hover** fill, so the tab that was open and whatever tab the pointer happened to be over were the same colour to three decimal places. The weight went too: 500 measures wider than 400, so selecting a tab widened it and pushed every tab to its right along.

The `+` button does two different things. With **no tabs open** it shows the panel's empty state — four cards: Files, Terminal, Canvas, Browser. With **something open** it drops a menu below itself listing the same four, because sending the panel to the chooser would take the tab away to ask a question: the tenant loses sight of what they were reading in order to add something beside it.

## Opening the panel

- **No session** (home, new conversation): a button in the window's top right.
- **In a session**: the left of the title row, beside the trace switch.

Either opens it; the same control collapses it when it is open. **The panel does not exist by default**: until the session produces something or the user opens a tool, the right-hand side takes no width. A conversation that is only a conversation should not lose a third of the screen to an empty panel.

## The Computer pane

Computer has two layouts because the two panel modes ask different things of it.

At the normal sidebar width, the desktop is the first thing in the pane: a rounded card with the native **1280:720** aspect. Its width follows the draggable panel width and its height follows from that ratio. noVNC therefore scales the desktop instead of filling a tall column with letterbox above and below it. The card and the schedule section beneath it sit on the panel's token-driven surface, so light, dark and deployment skins remain the source of colour.

The section below is the scheduled-task manager, not a copy of it. `dsh-scheduled-tasks` owns the list, loading, create/edit form, enable/disable and two-step deletion; the artifact panel only declares an empty data-attribute seat. The scheduled plugin follows that seat and mounts its own React root there because the panel itself is a separate body-level root. `scripts/check-computer-layout.mjs` holds the seat name and the 1280:720 aspect together across the two plugins.

When the panel is maximised, the schedule seat is not rendered and the desktop again takes the remaining height. Maximising is for operating the machine; restoring the sidebar brings back the compact card and its task list. The noVNC URL does not change between those structures, so the layout toggle does not define a second desktop protocol.

## The passive half is barely ours to render

dsh's `ui-deliverables` **already** renders a row of produced-file chips at the end of each turn. We compute no artifacts and render no list — we take over the click.

The seam is `ctx.remote.session.openWorkspacePath`: every file opening in the conversation converges on that generated Remote method (path links in tool rows, produced-file chips, file mentions in prose — `ui-chat` resolves them to absolute paths and calls it), and its default hands the file to the host operating system. In a headless sandbox that means `spawn xdg-open ENOENT`.

Generated Remote methods are configurable getter properties. Plain assignment either throws in strict code or silently leaves the transport getter in place, so the wrapper replaces and later restores the exact descriptor:

```js
const descriptor = Object.getOwnPropertyDescriptor(sessionRemote, 'openWorkspacePath')
const original = sessionRemote.openWorkspacePath
Object.defineProperty(sessionRemote, 'openWorkspacePath', { value: wrapped, configurable: true })
// on disposal: Object.defineProperty(sessionRemote, 'openWorkspacePath', descriptor)
```

The wrapper answers an absolute path with the same successful Remote result the Host would return after accepting it, then opens the panel tab. This keeps `ui-chat`'s caller contract intact without sending anything to the native opener.

**What cannot be taken over must be passed through.** A request without an absolute path calls `original` unchanged rather than swallowing the call, so an input outside this panel's contract still receives the harness's own validation and behavior.

The end-of-turn render chain is priority-ordered, so we could draw our own chip row ahead of `ui-deliverables`. **We do not**: with `openWorkspacePath` wrapped, the native chips already land in the panel, and replacing that row would only add a second coupling to upstream's render structure.

### What follows from the wrap

1. **One entry, many sources.** Chips, path links and file mentions all converge on one method, so all of them get the same behaviour without being wired separately.
2. **If the panel is shut, open it.** A click that does nothing is the worst outcome; open, add the tab, focus, in one gesture.
3. **Deduplicate by path.** Clicking the same file focuses the tab it already has.
4. **The viewer is chosen by extension and MIME**, with a download fallback so there is never a blank tab.
5. **Tabs belong to the session**, not to the window: switching sessions swaps the whole set.
6. **Focus is never taken**: only a click opens a tab, and an agent producing a file triggers nothing.

The sixth is the definition of passive; the first five are what keep it usable.

### What counts as produced

In dsh's session snapshot a `tool-result` node carries a `callView`:

```
{ card: 'diff' | 'generic', kind: 'edit', locations: [{ path }] }
```

`ui-deliverables` decides from it: **only results whose render intent is a diff card or an edit-shaped generic card count** — reads, deletes and failures do not — and the accumulation resets at a turn boundary.

Its blind spot is a file produced through a shell, `bash: python gen.py > report.html`: that tool-result carries no edit card and never counts. Covering it with `fs.watch` was rejected — an ignore list and ordering heuristics, 80% of the panel's complexity for 20% of the cases. When it matters, that path is rendered in the conversation anyway and a click opens it.

## The data plane is envd, so the plugin has no host half

The file plane goes through envd rather than through the tunnel: envd's interface is already complete, and reimplementing it inside the sandbox would be work for nothing.

That choice has a consequence worth more than the completeness: **the plugin needs no host half.** envd is addressed by the gateway from *outside* the sandbox (`Host: 49983-<sandboxId>.<domain>` via CubeProxy), while a dsh plugin's host half runs *inside* it — routing an inside process out and back again is pointless. So the plane is:

```
browser → gateway /sandbox/fs/*  →  CubeProxy  →  envd
```

The gateway already has the path: `callerOf(req)` resolves the caller and `sandboxes.ensure(username, caller.id)` hands back their sandbox, with no tunnel involved. So there is no `connection.rpc.handle` channel, no cordis host plugin, and no nginx location for a new dsh channel. `packages/dsh-artifact-panel` is therefore a **browser-only package**, and every envd call lives in `gateway/src/envd.js`.

A bonus: the panel works before the dsh backend is up — envd does not depend on it — so a tenant sees what is already in their workspace during a cold start.

Three of the four active tabs land on envd: the tree on `ListDir`, previews on `GET /files?path=` plus `Stat`, and the terminal on envd's PTY service — which needed a streaming path in `envd.js` and a WebSocket endpoint in the gateway to bridge it, because `envdRequest` decodes a whole body at `end` and a long-lived stream would block until it times out. A PTY through envd also means **no native terminal dependency in the sandbox image**.

The fourth cannot: the browser watch reads CDP, which listens on the sandbox's own loopback — deliberately, since that port drives the browser as the tenant — and envd does not forward TCP. So that one tab rides the `/browser` channel `dsh-sandbox-host` registers, through the tunnel, the way `/files` does. The panel stays a browser-only package either way; the host half it talks to belongs to the plugin whose subject is "what a remote machine cannot show".

### The canvas is not a browser

The third active tab was once conceived as a browser — look at the agent's dev server, or reach the public web — and became a **canvas: the page the agent is building**.

That is not a simplification, it is a move back onto the test. A dev-server browser is a **tool** with a machine behind it; the canvas is the **artifact itself**. The cost differs by an order of magnitude: a reverse proxy, a wildcard certificate, absolute-path rewriting, WebSocket forwarding and an egress boundary all exist to serve a dev server, and a static page needs none of them — while `/sandbox/preview/<ticket>/<path>` was already built.

Two settled trades:

- **The public web is allowed.** The CSP carries only the `sandbox` directive (which removes the same origin); `script-src` and `connect-src` are unrestricted, so a page the agent writes can pull a charting library from a CDN. Tightening that would narrow what the agent can produce.
- **The canvas follows its own page.** Every two seconds it asks which page is newest and whether it was rewritten, and reloads when it changed. This is a deliberate exception to "focus is never taken", and it holds: opening the canvas *is* the user saying "show me what you are making". It still never opens the panel by itself and never touches another tab. It follows **modification time** rather than the produced-file signal, because that signal's blind spot is exactly where the canvas cannot afford one — a page written through a shell redirect never appears in it.

### The browser tab is a window, not that browser

The fourth tab looks like the thing the section above rejected, and is not. What was rejected was an **interactive** browser with a machine behind it — the reverse proxy, the wildcard certificate, the path rewriting and the egress boundary all existed to let a person drive pages served inside the sandbox. What this tab is instead is a **watch**: the agent drives a headless Chromium in there through its own CLI, and without this tab that work is invisible — commands succeed in the transcript while the page they acted on appears nowhere.

So the tab shows what the agent's browser is showing, and nothing more: about once a second it asks the sandbox for a JPEG of the page and draws it, with the open pages listed beside it. Read-only on purpose — a person and an agent sharing one browser's hands is a fight, not a feature — which is also why none of the dev-server machinery returns: one polled image over the request/response channel, no clicks, no keystrokes, no proxy. Frames are asked for only while the tab is showing and the window visible; a closed tab costs the sandbox nothing.

## Two path constraints that have to be right

**One: absolute paths only.** `ENV HOME` in the `Dockerfile` is a container environment variable, not root's home in `/etc/passwd`, and envd resolves relative paths through passwd — so `path=notes.md` lands at `/root/notes.md`. The gateway refuses relative paths outright rather than guessing a prefix. Session cwd is resolved on the client: `ctx.sessions` carries each session's `cwd`, and relative paths become absolute in the browser before the gateway sees them.

**Two: paths are pinned inside the workspace (`/mnt/workspace`), and that is a scope rather than a fence.** The one security property is not in the path handling at all: **`callerOf` resolves the caller and `sandboxes.ensure` hands back that caller's own sandbox**, so a request can only reach the machine of the tenant who made it. Reading across tenants is not "prevented", it is unrepresentable.

Inside a sandbox there is nothing to defend: the boundary is the sandbox, a tenant is root in their own, and the agent is a root shell they can type into. So the root makes this a **workspace browser** rather than a filesystem browser.

**Which is why symlinks are not resolved.** An earlier version ran `realpath` on every path and re-checked the result, to stop links pointing out of the workspace. It bought no security — the same content is one sentence to the agent away — cost a round trip per request, and was wrong behaviour besides: a tenant who links their own directory into their own workspace should be able to open it.

The prefix comparison itself has to be written properly: normalise separators, drop the trailing slash, and require `t === b || t.startsWith(b + '/')` — a bare `startsWith` admits `/mnt/workspace-evil`.

## HTML preview: same origin, CSP sandbox

A preview needs no origin of its own. A same-origin path prefix plus response headers is enough:

```
content-security-policy: sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'
x-content-type-options: nosniff
referrer-policy: no-referrer
```

The `sandbox` directive **omits `allow-same-origin`**, so the browser forces an opaque origin on it. The iframe's own `sandbox` attribute is the first boundary and this header is depth — it holds even if the document is opened top-level from a popup.

Preview URLs must be **path-encoded** rather than query-encoded: a query loses the session scope when the browser resolves relative paths, and the previewed page's `./style.css` and `img/x.png` 404.

## How it mounts: a body-level portal

**The whole-panel slot is taken by `ui-layout`** and is not available to plugins. So the panel mounts a host of its own on `body`, with its own React root and fixed positioning. That is not a workaround; it is the only route on this platform. What comes with it:

- **A data attribute on the root**, so skins and outside CSS can scope overrides to it;
- **Layout variables on `<html>`**, live while the panel is open and updated per frame while it is dragged;
- **A z-index below the host's overlay stack**: DSH's overlays sit at 100 and 1000+, the panel at 40, so any dialog covers it naturally;
- **Class names are not a contract**: CSS Module hashes change, so anything that must hit precisely uses the `[data-dsh-artifact-panel]` attribute selector.

One exclusion: the `dsh-web-ui` family ships an `aionui-panel` right-hand provider, and when it is selected this panel must not mount at all or the two stack. **That decision has to stay live** — the provider is switched in Settings, and the moment it switches the two would overlap; the panel subscribes to the runtime's `settings/document-updated` broadcast, re-evaluates and unmounts, falling back to a start-up decision only where no `remote` service is available.

Width and collapsed state live in the plugin's own settings. **The preference must be read before the first mount**, or a new session draws one frame at the default width and jumps; but reading settings cannot wait forever, or a broken settings route means the panel never appears at all — so a two-second timeout races it and the panel mounts on the schema default when it wins.

## Platform constraints

- **The build-purity gate**: a client bundle may not value-import `@dsh-external/*` or non-allowlisted `@deepseek-ai/*`. `import type {}` is erased and does not trip it.
- **ModuleLoader does not cross plugins**: never require another plugin's module. A cross-plugin surface needs an explicit owned contract — a method when behavior crosses, or the checked data-attribute seat used by the schedule manager when one plugin owns rendering inside another's layout.
- **Skins are token-driven**: consume `--dsw-alias-*`, `--dsw-font-*`, `--ds-*` and hard-code no colour. In particular — **never consume `--dsw-specific-sidebar-fill`**, which belongs to the host's left navigation column and which some skins set to `transparent`. The panel's own surface is `--dsw-alias-bg-layer-1`.
- **A token name must be verified before it is used.** Confirm in a real browser that the name is a defined CSS custom property on `body`. Names known to work are `--dsw-alias-interactive-bg-hover` (hover) and `--dsw-alias-button-ghost-active-fill` (pressed). **Once verified, do not write a literal fallback** — it only hides the next missing name.
- **Translucent surfaces need a fallback**: a text surface that reads a glass value below 0.9 alpha falls back to an opaque ground, or text scrolls over the skin's background. That fallback **cannot** be written as `readToken() || fallback` — `transparent` and `rgba(...,0.16)` are both truthy strings and the `||` never fires.
- **Match the host with documented theme tokens only** (`--dsw-alias-*`, `--dsw-font-*`, `--ds-*`). Do not copy computed styles, and do not treat hashed CSS-module class names as a contract.
- **i18n follows `ctx.locale`**, not the browser's language.
- **There is a build step, for one reason**: the terminal needs a renderer, so xterm is bundled from inside the package (`build.mjs`). Nothing the host already provides is bundled — `require('react')` in the source is the local binding `__ModuleLoader__.load` hands in, which the bundler leaves alone.

## What is in a sandbox, and what is not

- `/app/sandbox/env.sh` is **not sensitive**: it is the allowlisted projection at the end of the [`Dockerfile`](../Dockerfile), written from the image's `ENV` values. The names in that file are the whitelist; this page does not restate them.
- `/proc/<backend pid>/environ` carries `MODEL_API_KEY` and `SANDBOX_TOKEN`. Under CubeSandbox the first is a **placeholder** — the real key is put on the request by the egress policy as it leaves and never enters the sandbox (see the model plane in [`design.md`](./design.md)). A tenant can read their own environment with `printenv` regardless, which is why the panel defends nothing here: what it could withhold, `printenv` hands over.

## Related work

`github.com/omdsh-dev/DSH-better-sidebar` is a MIT-licensed local plugin (with a host half) on the same dsh frontend. This panel runs in a sandbox and goes through envd; the platform constraints the two share are written in the sections above. Attribution is collected in the repository's [NOTICE](../NOTICE).
