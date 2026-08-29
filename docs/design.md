# Design notes

English | [中文](design.zh.md)

Why this deployment is shaped the way it is. The [README](../README.md) covers
what it is and how to run it.

## Why nginx is the front door

The frontend derives both its API base and its WebSocket URL from
`location.origin`, so everything has to arrive on one origin. That origin is
nginx: it answers `index.html`, the client bundles, and the hashed assets from
disk, and proxies only what needs a session — `/api`, `/login`, `/logout` — to
the gateway. Every request stays same-site, so no CORS layer is involved.

The gateway sat in front at first, which put a Node process in the path of every
static byte: a cold load fetches index.html and 37 client bundles, and routing
them through it measured ~26% more latency per request while buying nothing.

The shell still needs a session — an unauthenticated visitor who loaded it would
watch it retry a 401 forever, since the frontend knows nothing about this login
page — so nginx gates `/`, `/index.html`, and `/plugins/*` with `auth_request`
against the gateway's `/_auth`, which answers a status and no body.

## The frontend does not need a sandbox

The Vite build is a shell, not a standalone application: only a dsh host
injects `window.__DSH_BOOT__`, the entry graph naming the client plugin bundles
and their revisions, and only a dsh host serves those bundles under `/plugins`.
Serving the build alone gives a page that loads every asset and then fails to
boot.

They do not have to come from a *running* one. The graph describes a
composition, not a tenant — every sandbox here runs the same image and serves
byte-identical output — so [`web/harvest-shell.mjs`](../web/harvest-shell.mjs)
boots that composition once during the build and saves what it serves. The web
deployment then holds the whole frontend, and the interface loads whether or
not the caller's sandbox is running. Only `/api` needs one.

The harvest runs in the sandbox image, not the builder, and that is
load-bearing: the composition adapts to its environment. A host with a native
directory dialog composes `directory-picker-native` where a Linux container
composes `directory-picker-browse`, and the bundle revisions differ too, so
harvesting anywhere else would ship a frontend whose plugin set does not match
the backend it talks to.

There is no fallback from the web deployment to a sandbox. A path the web
deployment does not have 404s, because the only thing a miss can mean is a web
image that does not match the sandbox image, and answering it from a sandbox
would both hide that and put interface bytes back on a per-tenant component.

That also removed the one frontend path which was not a static artifact.
`/plugins/events` is the client hot-reload channel: the browser opens it and
holds it, expecting a live host to push rebuild notices. Nothing rebuilds these
bundles while a tenant is signed in, so the row is switched off in
[`sandbox/cordis.patch.yml`](../sandbox/cordis.patch.yml) — applied to the harvest
and the sandbox alike, or the harvested manifest would name a composition the
backend does not run.

What needs a session is the app surface — `/`, `/index.html`, `/plugins/*` —
not the shell assets, which carry nothing of any tenant's. Gating those
protects nothing and breaks the requests a browser makes without credentials by
design: a `<link rel="manifest">` sends none unless the tag opts in, which this
`index.html` does not, so a redirect to `/login` arrives at the manifest parser
as HTML.

## Why the sandbox dials outward

The sandbox needs no inbound reachability, no published port, and no dsh
configuration change: dsh keeps its default loopback binding and its default
empty `trustedHosts`.

It also has a consequence worth stating plainly. dsh guards `/api` with a fence
that pins its configuration methods — `settings.*`, `credentials.*`,
`agentPreset.*`, `host.pickDirectory`, `host.openPath`, `llm.discoverModels` —
to loopback callers, and a declared `trustedHosts` authority cannot reach them.
Because the tunnel client replays every request across the sandbox's own
loopback interface, those methods keep working, so the frontend's Settings and
Models pages stay functional. A deployment that instead exposed the sandbox
port would serve ordinary methods and answer 403 for all of them.

The same rewriting disarms the fence, which is a confused-deputy defense (DNS
rebinding and cross-site), never an authentication layer — dsh ships none and
records remote-deployment authentication as deferred work. **Authentication at
the gateway is therefore the only thing protecting an agent that runs shell
commands.** Everything under `/api`, HTTP and WebSocket alike, is refused
before it can reach a tunnel unless it carries a valid session.

## DSH is a dependency, not part of this

The harness is installed from npm at a pinned version. Nothing here patches it:
the tunnel, the remote-host surfaces, the account controls, the artifact panel,
and this deployment's own brand are cordis plugins, named in
[`sandbox/cordis.patch.yml`](../sandbox/cordis.patch.yml) and
[`sandbox/harvest.patch.yml`](../sandbox/harvest.patch.yml) and resolved out
of the profile's `node_modules` like any other. Upgrading DSH is a version
bump and an acceptance run.

Every image is a target of [`Dockerfile`](../Dockerfile) with the
repository root as its build context. One `npm install` in the `deps` stage is
shared by all of them, and the toolchain that builds `node-pty` stays in that
stage rather than shipping in what runs.

`@deepseek-ai/dsh-web-frontend` is installed by name alongside `dsh` rather than
arriving through it. cordis resolves plugins by package name at load time, so
which packages a composition needs is not derivable from the dependency graph —
the frontend is not reachable from the CLI through it, and a composition that
needs another package will need naming here too.

What a tenant runs is the artifact: `lib/bin.js` under plain Node, the same
entry the npm package ships as `dsh`.

## The front door serves TLS

The client plugins call `crypto.randomUUID`, which is undefined on a page served
over plain HTTP to anything but `localhost`. A deployment reached at a LAN or
public address therefore has to be HTTPS or it fails on load, and nginx listens
on both 80 and 443.

Plain HTTP redirects to the TLS site, but only once `PUBLIC_HTTPS_PORT` says
where that is. nginx sees the port it listens on inside the container and not
the one the container publishes, so it cannot derive the address: a bare
`https://$host$request_uri` would send every visitor to 443, where this
deployment is not. Until it is told, the plain port serves the site rather than
redirecting somewhere that will not answer — which is also what a `localhost`
deployment wants, since `crypto.randomUUID` is available there over plain HTTP
and there is nothing to redirect for. The host comes from the request rather
than from configuration, so a deployment reached by several names keeps
whichever one the visitor used.

By default the web container generates a self-signed certificate for `TLS_SAN`
on first start, which makes the page a secure context at the cost of a browser
warning. `compose.tls.yml` replaces it with a real one: acme.sh issues over
DNS-01 and renews on its own, which is also the only challenge available to a
deployment that cannot use ports 80 and 443 — a certificate names a host, not a
port, so it is equally valid on 8443.

## Registering and signing in

There are no passwords. A visitor types an address, the deployment mails a
six-digit code, and answering it both registers the address the first time and
signs it in every time. That removes the two things a password deployment has to
get right and never quite does — storing them, and recovering them — and it is
why there is no "forgot password" anywhere: an address that cannot receive mail
is not one this deployment can do anything about.

The code is the whole credential, so it is guarded like one. Six digits over
five attempts and one code per address per minute, spent on first correct use,
compared in constant time, and answered identically whether or not the address
has an account — asking for a code is not also a way to ask who has registered.

Registration is gated on an invite. `REGISTRATION=open` removes the gate; left
alone, a new address needs an unused code, and a returning one needs nothing —
the invite bought the account, not each session. It is checked after the mailed
code rather than before, so the first step answers identically for every
address: asking a stranger for an invite and a returning tenant for nothing
would make the form a way to ask who is registered.

Both the gate and the ceiling beside it are switches in the administrator's
console, and the environment is only where they start: `REGISTRATION` and
`SANDBOX_LIMIT` are read from the database on every sign-in, so closing
registration while a link is circulating in a group chat closes it for the next
person to follow it rather than for the next restart. The ceiling is the most
sandboxes that may run at once — 0 is no ceiling — and it is the host's memory
written down. A sign-in that would exceed it is refused after the code and
before the invite is spent, so a full deployment costs a visitor the wait and
not their code; whoever is already holding a machine passes regardless, because
they cost nothing further, and so does an administrator, who has to be able to
reach the console that raises the number.

This deployment states what it does with what a tenant gives it, and the
statement has to stay true of the code: three documents at `/policy/…` — the
terms, the data notice, and the safe-use policy — served by the gateway beside
the sign-in page they are linked from, because they are what someone reads
before they have an account. Two of them are shorter than a commercial
equivalent for a structural reason rather than a stylistic one. The deployment
runs no model, so what governs the inference is the upstream provider's policy
and the safe-use document says so instead of restating it badly; and having no
model, it has no use for tenant data at all — no training, no profiling, no
analytics, no third-party script — so the data notice spends its length on the
honest part, which is what nonetheless leaves: the model provider and the mail
sender.

Agreement is a checkbox on the sign-in form, and it is checked on every sign-in
rather than only at registration for the same reason the invite is only checked
after the mailed code: this form does not know which of the two it is doing, and
an answer that differed would say who has an account. What the box carries is
the documents' version rather than "on", so what is recorded on the account is
which text was actually on the page — and a form left open across a change to
the documents is asked to read the new one rather than silently accepting it.

The other half of that promise is being able to leave. `/profile/delete` closes
an account from the profile page: it revokes the sessions, releases the sandbox,
destroys the volume and deletes the row, in that order and through the same
`eraseAccount` the administrator's own delete runs — two paths that took
different things away would be two different promises about what deletion means.
It is confirmed by typing the address, which is a confirmation a browser with no
JavaScript can also give.

A session is then two tokens. The access token is a signed JWT the gateway
verifies without asking anything, which keeps the store off the path of every
`/api` call — and, for exactly that reason, cannot be taken back, so it lasts
fifteen minutes. The refresh token is opaque, recorded in Postgres, and rotates on
use; revoking it is what makes signing out, suspension, and deletion take
effect. Fifteen minutes is therefore the honest answer to how long a revoked
session can still reach a shell.

Renewal happens in the gateway, not the browser. The frontend is dsh's own
shell: it knows nothing about these tokens and would meet an expired one as a
401 it retries forever. So the gateway renews on whatever request notices — and
on nginx's `auth_request` too, which is how a tab left open overnight gets a
working session from a reload instead of a login page.

## One store

Accounts, invites, refresh tokens, and the sign-in codes outstanding right now
all live in Postgres. Redis held them first and was removed rather than kept
alongside: nothing was left in it once accounts had to be durable, and a second
store means a second backup, a second failure mode, and two answers to "is this
deployment's data safe" instead of one.

Losing an account is worse than losing a session. A tenant's workspace is named
by their account id, so an account that vanishes takes their files with it even
though the files are still on the disk.

Sign-in codes are the only short-lived rows and expire by a column rather than
by the store, so a row that outlived its use is already invisible to every read
and the sweep is housekeeping rather than correctness.

## The operator's console

A separate service on a separate hostname, with a credential that belongs to the
deployment rather than to any account: a username, a password, and a second
factor enrolled from the console itself. It used to be `/admin` on the tenants'
site, reached by a tenant who happened to be named in `GATEWAY_ADMINS`, and that
was hiding rather than isolating — an operator is a different kind of principal
from somebody who signed up, and running both through one session made the one
surface that can change every account a page on the surface every tenant reaches.

It shows who has registered, when, the tiers they are on, the invite codes and
who used them, and a box to mint more. It does not show whether a sandbox is
running: that is the platform's to answer and the gateway's to ask, and a count
this service learned from a third party some seconds ago is worse than a count it
does not show.

Two things can be done about an account. Suspending keeps the account and
everything it owns, and revokes its sessions so it takes effect now rather than
at the next sign-in. Deleting takes the account, its sessions, its sandbox and
its volume — asked of the gateway over an internal channel, because that is the
same sequence a tenant's own deletion runs and two versions of it would be two
different promises about what deletion means.

`GATEWAY_ADMINS` no longer opens anything. It marks accounts on the console, and
stands in for `POLICY_CONTACT` when that is unset.

## What a tenant keeps

Under CubeSandbox a tenant's workspace and history outlive their sandbox. Each
gets one volume, created through CubeSandbox's API and attached at `/mnt` by
the driver in [`integrations/cube-volume-juicefs/`](../integrations/cube-volume-juicefs/README.md): one JuiceFS
filesystem holds every tenant's directory, with its metadata in Postgres and its
blocks in an S3-compatible store.

Host directories came first and bounded nothing: one `dd` filled the host disk
and took every tenant with it. A volume has two ceilings instead — the filesystem's
own capacity and a per-directory quota — and JuiceFS enforces both, rather than
anything the gateway would have to be trusted to count.

`entrypoint.sh` creates the workspace and the harness home as real directories
under the mount — `/mnt/workspace` and `/mnt/dsh` — and tells dsh that is
where they already are. Nothing is linked or bound out to a second name.
The one exception is `profiles/`: it holds the composed web profile and this
project's plugins, so it is a link back to the image's own copy, remade on
every boot. Persisting it would shadow the image's copy with a stale one and
leave dangling links after an upgrade.

Writes are acknowledged before they reach the object store. The driver stages a
block on local disk and uploads it in the background, and the metadata database
commits without waiting for its own fsync — together that is a small-file write
at 8 ms rather than 38 ms, at the cost of the last moment of work if the node
itself is lost. [`integrations/cube-volume-juicefs/README.md`](../integrations/cube-volume-juicefs/README.md#performance)
has the measurements and the settings that undo it.

A sandbox is reclaimed once `SANDBOX_IDLE_TTL_MS` passes with its tunnel quiet.
Quiet, not unrequested: one agent turn can run for hours and streams its answer
over a socket opened before it began, so judging on requests alone would destroy
the sandbox with that turn's work still inside it. Nothing in the tunnel is a
heartbeat, so an abandoned browser tab holds its socket open in silence and is
still reclaimed on time.

Volumes are named by account id rather than by address, so an address deleted
and registered again gets an empty one rather than the previous holder's files.
Deleting an account destroys its volume, which is the only moment that is right
— a reclaimed sandbox must leave it alone, since keeping it is the point.

## The tunnel is a plugin, not a process

It runs inside the dsh process it serves, inserted into the composition by
[`sandbox/cordis.patch.yml`](../sandbox/cordis.patch.yml). A patch layer targets
existing ids, so adding a plugin takes an explicit `insert` list.

What that buys is not mainly the ~22 MB a second Node runtime cost per sandbox.
It is that `inject: ['connection', 'apiProxy']` *states* when the `/api` surface
exists, where a separate process could only probe for it — and dialled too early
twice before that probe was right, once before the socket accepted connections
and once before the API plane was mounted. The gateway releases held browser
requests the moment a tunnel appears, so both reached a person.

Requests still cross the loopback interface rather than being handed to the
route's handler in memory. dsh's loopback pin lives inside the shared fetch
handler, so an in-memory call would have to construct an equivalent request
anyway, while also reaching past the route's body limits and composition. One
loopback round trip buys behaviour identical to a browser's.

## When the machine is up and the backend is not

Under Docker these are one fact. The entrypoint waits on the dsh process, so a
backend that dies takes its container with it, and the next request builds a new
one. Under CubeSandbox they come apart: envd is PID 1 and outlives whatever it
started, so a crashed harness leaves a microVM that is healthy, reachable, and
empty. The gateway learned "is it up" from the tunnel alone, and read that empty
machine as one to tear down and replace.

Replacing it is wrong twice over. It destroys the evidence, and on a deployment
with volumes the fault is usually on the volume — the same broken configuration
is mounted into the replacement, which dies the same way. A tenant who had
written an invalid `cordis.patch.yml` could watch that happen indefinitely.

So `tunnelFor` asks the machine before destroying it: a `true` that exits zero
over envd means alive, and a live machine with no tunnel is a failed backend
rather than an absent sandbox. That state leaves `/_auth` as `X-Recover: 1` on
the shell document, which a `map` turns into a redirect to `/recovery` — the
tenant lands on a page instead of on a spinner that will never resolve.

The page offers what a person needs, ordered by what it costs them:

| | What it does | What it keeps |
|---|---|---|
| Log | the last lines the backend wrote before it stopped | everything |
| Files | reads and writes anywhere in the sandbox, the volume included | everything |
| Terminal | a shell on the live machine, over the same envd | everything |
| Start backend | runs dsh again, same identity and same secrets | everything |
| Rebuild | a new machine from the template, the same volume | their files |
| Erase | a new machine and a new volume | nothing |

The first four exist because the machine is alive, which is the whole point: a
tenant whose backend will not start can read why, fix the file that caused it,
and start it again without losing the work that surrounds it. The last two are
there for when that fails, and erasing asks for an acknowledgement the dialog
collects — and answers 502, not 204, if the volume was not actually destroyed.
A page that reports "erased" over surviving data is the one wrong answer worse
than an error.

## Header rewriting

The tunnel replays browser requests against local dsh with three changes, each
required by a distinct arm of the fence:

| Header | Rewrite | Without it |
|---|---|---|
| `Host` | set to the dsh loopback authority | 403 — the authority is neither loopback nor trusted |
| `Origin` | removed | 403 — an attached Origin must equal the Host authority |
| `sec-fetch-site` | removed | 403 — an explicit `cross-site` marker is refused outright |

The gateway's session cookie is stripped as well: authentication is settled at
the gateway, and forwarding the cookie would place one tenant's session token
inside a container that tenant's own agent can read.

WebSocket upgrades pass the same fence, so `/api/events.mux` and
`/api/events.host` need the identical rewriting; the client additionally drops
the browser's `sec-websocket-*` headers so the local handshake key is the one
`ws` minted and can verify.

## Where session state lives

Sessions are kept in Postgres, so the gateway holds no disk state and a restart
does not sign anyone out — an open tab cannot recover from that on its own,
because the frontend retries a 401 indefinitely rather than returning to a login
page it knows nothing about. Expiry is a column every read filters on rather
than a store's own eviction, so a row that outlived its use is already invisible
and deleting it is housekeeping.

A server-side store rather than a self-validating token, because logout has to
actually revoke. A signed stateless cookie stays valid until it expires and
nothing can take it back, which is the wrong property for a session that reaches
a shell.

## The tenant's own environment

The agent inside a sandbox reaches things this deployment has no business
knowing about, and reaching them needs a credential. There was nowhere to put
one: the model credential belongs to the deployment and lives in `settings`, and
everything else a sandbox was given was decided by the gateway. `sandbox_secrets`
is the tenant's half of that — names and values they set in Settings, injected
when their sandbox is created.

Handing a tenant a lever on their own sandbox's environment is only safe because
of the order the environment is composed in. `sandboxes.js` lays theirs down
first, then the sandbox's identity and dial-in URL, then the deployment's model
credential — so a name a tenant should not have set is overwritten rather than
obeyed. `secrets.js` refuses those names on write as well, and the two checks
are independent on purpose: the write-time list is the explanation a person
gets, and the ordering is what holds if a row ever reaches the table another
way. Reversing any pair of those spreads hands something over —
`SANDBOX_TOKEN` is another sandbox's session, `GATEWAY_TUNNEL_URL` is somewhere
else to dial, `MODEL_BASE_URL` is somewhere else to send the deployment's
key.

Because of that, the sandbox page carries the one control that applies a change:
restarting. Nothing actually restarts — `POST /sandbox/restart` releases the
sandbox, the manager forgets it, and the next request builds a fresh one, which
is exactly what idle reclamation already does. It is therefore not a new
lifecycle for the deployment to survive, only a way for a tenant to ask for the
one it already has. It interrupts whatever the agent was doing, so the control
asks twice before it acts.

A value goes in and never comes back. The page shows the name and that it is
set, which is what somebody auditing their own configuration needs; serving the
value would put it in a screenshot, a scroll-back, and whatever proxies the
response, for something its owner already has. And because an environment is
fixed when a process starts, a change reaches the next sandbox rather than the
one already running — which the page says outright rather than leaving to be
discovered.

## The account section

Sign-out is the deployment's, not dsh's: the harness has no notion of the
gateway's tenants, so nothing in its own composition can end a session.
[`packages/dsh-tenant-account`](../packages/dsh-tenant-account) adds an Account page to
Settings — the caller's name from `/whoami`, and a control that posts to
`/logout`, which revokes the session and releases their sandbox.

What a tenant is called and what they look like belong to the deployment for the
same reason, and `/profile` is a gateway page rather than a panel in Settings: it
edits an account dsh has no notion of, and it has to work on the way in, before a
sandbox exists. It is unskippable by construction rather than by persuasion —
`/_auth` answers 403 for a tenant who has never chosen a name, and nginx turns
that into a redirect exactly as it turns 401 into one to the login page. Only the
shell document is charged for the check: the same gate guards three dozen plugin
bundles on a cold load, and asking the database about each of them would be three
dozen queries for one page.

The picture is a `data:` URI on the account row. The browser crops and encodes it
to 256×256 on a canvas before it is ever submitted, so what crosses the wire is
tens of kilobytes rather than whatever came off a phone — and so the gateway,
which holds the Docker socket, never decodes tenant-supplied image bytes. It is
matched against the shape a `data:` URI may have rather than parsed, and SVG is
refused outright: it is a document with script in it, and this value is
interpolated into an `img` on a page the deployment serves. It travels inline with
`/whoami` rather than as a second request, because an object store for an image
only its owner ever sees would be a second backup and a second failure mode for
the sake of one column.

It is a real client plugin, registered into `settings.section` beside the
shipped pages. Three things make that work, and each fails silently rather than
loudly if missed: the package is installed into the profile's `node_modules`,
because the client-module registry resolves a plugin's package.json from the
config tree's baseUrl and scans only what it can resolve by name; its `exports`
must include `./package.json`, or that resolution is blocked by the exports
gate; and the browser half is written against `window.__ModuleLoader__`, whose
`require` is the shell's module table — which is where React comes from, so the
package needs no build step and never resolves through node_modules.

A plugin loaded by path mounts its host half and contributes
no client half at all.

## What a container cannot do

dsh is built for a host on the desk of the person using it. The browser and the
backend share a filesystem there, so a path is enough: a file worth talking
about is already reachable, and a document worth reading opens in whatever the
desktop associates with it. Moving the backend into a sandbox takes that premise
away, and several surfaces are built on it.

The harness has one signal for this — `host.describe().canOpenPath`, which is
already false here, because it asks the platform and finds Linux with no display
server. `sandbox/cordis.patch.yml` states it outright anyway, as `nativeOpen:
false` on the `api-gateway` entry: the detected answer is correct by coincidence
of the base image, and anything that later put a DISPLAY into this container
would flip it back.

Where a surface consults that signal, it already degrades: the agent-preset page
offers "show location" instead of "open location", and the deliverables row
omits "show in folder" entirely. Where a surface does not, it is a dead control
in every sandbox:

- **Settings' "Open configuration file"** gates on
  `settings.describe().hasDocument`, which reports whether the file *exists* —
  it always does — rather than whether anything can open it. `agentPreset.list`
  spells the same field `canOpenPaths()`. One of the two is wrong.
- **File links in the transcript** — the produced-files row a turn ends with,
  and the inline path references in its prose — call `openFile` unconditionally,
  and the failure is swallowed by a `.catch(() => {})`.

`dsh-sandbox-host` replaces the first with the capability it can actually
provide: a Configuration page that shows the document, since a document is what
a person here can be given, and a document does not fit in the header's action
row. The header cell it vacated is left empty — the gesture moved, it was not
hidden.

The second is not reachable from a plugin: `openFile` is injected by
`ui-conversation` into its own chat view, not offered as a slot, so replacing it
means replacing the whole view. That is an upstream issue and a documented
limitation, not a patch layer; see
[sandbox-pitfalls](sandbox-pitfalls.md).

Shadowing a cell takes a *different* `priority`, not the same one: sharing an id
at equal priority is refused outright, which fails the whole plugin rather than
the one cell. `priority` is also not `order` — order is position within a cell,
priority is the cell's shadowing rank, and the lowest renders.

## Getting a file into a sandbox

On a local host nobody uploads anything: the person names a path and the agent
reads it. Here the path they can name is on the wrong machine, so the deployment
has to produce one.

The path never appears in the composer. Writing it there was the first cut, and
it was wrong twice over: the person reads a path they did not type, in a box
that is already showing them a card for the same file. dsh has a better seat for
it — the agent inbox takes injected context, the same channel approval notices
and attached snapshots ride. A commit appends a `plugin`-sourced message to
`next-step`, which is invisible until the next turn claims it and then renders
as a context row rather than as words the person appears to have said. Taking
the card off the message retracts that notice, so the agent is never told about
a file somebody changed their mind about.

Nothing new reaches the model beyond that text: no content block, no provider
contract, no agreement with the harness about what an attachment is. (dsh's own
attachment plane is images only, and says so — generic files are deferred
upstream pending a lifecycle and provider contract.)

The card itself is rendered where dsh renders its own image thumbnails: inside
the composer card, above the textarea. No slot reaches there — that position is
the `accessory` prop on the composer bar — so the node is moved into place after
render, and the `+` menu's "附件" group is a second panel drawn above the real
one. Both place the plugin's own nodes where no public slot reaches, both key
on ARIA roles rather than hashed class names, and both are reported upstream;
see [sandbox-pitfalls](sandbox-pitfalls.md).

The endpoints live on `/files`, a channel of dsh's own RPC registry, and not on
`/api`. `/api` accepts exactly one interceptor and dsh's `typert-gateway` holds
it; a second registration throws at mount. A channel of its own costs one nginx
location and one line in the gateway's routing, both of which treat it exactly
as they treat `/api` — authenticate the caller, hand it to their sandbox, know
nothing about what is on it.

Uploads are chunked at 4 MiB, and the body limit is not why. dsh accepts 300 MiB
and nginx is set to 320. The tunnel is a single WebSocket carrying every request
as base64 frames, so a file sent whole holds it for the duration and every other
call queues behind it.

Bytes land in a staging file and become visible only on commit — a half-written
file an agent could pick up reads as a complete one — and they are published by
hard link, which fails on collision rather than overwriting. Two files of one
name uploaded on one day are two files. The destination is
`<workspace>/uploads/<date>/`, and the workspace is `/mnt/workspace`, a real
directory on the tenant's volume whenever they have one, so an upload outlives
the sandbox that received it.

## What a tenant's agent is given

The sandbox is where the work happens, so what is installed in it is the
difference between an agent that can answer a question about an attached
spreadsheet and one that can only describe the file. It ships:

- the search and text tools an agent reaches for — `rg`, `fd`, `jq`, `tree`,
  `patch`, `file`, `less`;
- archives in both directions — `unzip`, `zip`, `7z`, `zstd`, `bsdtar`;
- documents — `pdftotext`, `sqlite3`, and `officecli`, one binary that reads
  and writes xlsx, docx, pptx and pdf without a headless office suite behind
  it;
- reachability — `dig`, `ping`, `ip`, `nc`, which is the first thing anyone
  debugs in a sandbox whose whole architecture is dialling out;
- a Python with pandas, duckdb, the spreadsheet and PDF readers, pillow and
  matplotlib already in it;
- and a CJK font, because a chart with Chinese labels renders as boxes without
  one and nothing about that failure says "font".

OfficeCLI carries its own agent skill, and the image installs it into a bundled
skill root of its own (`DSH_BUNDLED_SKILL_DIR`) rather than into
`$DSH_HOME/skills` — that directory lives on the tenant's volume, so an
image-owned copy there would be shadowed by whatever they have. Written by the
binary at build time rather than kept as a second copy in this repository,
because OfficeCLI updates the skill with itself and a copy here would age
silently against the version pinned in the `Dockerfile`. Only the base skill: the specialized ones
are printed on demand by `officecli load_skill <name>`, so putting all eleven in
the catalog would spend a description line in every request for ten skills a
tenant may never open. The bundled root ranks below the tenant's own, so a skill
they write under the same name wins.

Python is a virtualenv on `PATH`, not the system interpreter. Debian marks that
one externally managed, so `pip install` there fails by design and
`--break-system-packages` is a way of saying the design was wrong. The venv
gives a tenant an ordinary `pip install` that cannot damage the distribution's
Python — and both package managers carry the deployment's mirror *into* the
image (`/etc/pip.conf`, npm's global config), so a tenant's own install reaches
the same mirror the build did rather than waiting out the public index.

The cost is the number that matters: the image went from 617 MB to 1050 MB, and
a CubeSandbox template is a snapshot of it. That is why the list is shorter than
the one a full data-science image would carry. Measured in the built image and then cut:
`pyarrow` (152 MB, and duckdb reads parquet in 58), `plotly` (42 MB, and what a
chat window shows is the static image matplotlib already draws), `libgl1` (41
packages of OpenGL that nothing here draws through), `unar` (18 packages of
GNUstep for archives `bsdtar` reads). Each is one install away.

Not taken at all: database drivers, because one deployment's databases are not
another's; and a compiler, because every wheel here is prebuilt for this
platform and a source build is the one thing a tenant has to arrange itself.

## The browser in the sandbox

An agent that cannot open a page can only describe the web second-hand, so the
sandbox carries a browser. The binary behind `/usr/local/bin/headless-shell`
is chosen at image build by `BROWSER_SOURCE`:

- **`playwright`** (default, what CI builds) — chrome-headless-shell, the
  UI-less Chromium Playwright itself pins, installed by the bundled Playwright
  inside the pinned `@playwright/cli` so the engine is exactly the build that
  CLI version expects. The download host is npmmirror, because this repository
  is built from inside China where Playwright's default CDN is the step that
  fails — the same reason OfficeCLI arrives from a CDN.
- **`antidetect`** (what a production host with the patched binary builds) —
  a full Chromium compiled on that host with the anti-detect patches
  (`navigator.webdriver` always false, no `Headless` in the product string,
  automation and bad-flag infobars off). Before the image build the host
  rsyncs its latest `chrome-dist/` into `sandbox/browser-engine/` (see
  [docs/cubesandbox.md](cubesandbox.md)) — never a stale packaging image.
  The directory in git holds only a placeholder — 329 MB never lands here.
  The light sandbox still omits VNC / noVNC / horust and keeps `--disable-gpu`
  in `browser-flags` (no X display; ANGLE+SwiftShader would crash-loop the
  GPU process). The **desktop** image (`hamsterhq-desktop`) is where TigerVNC
  + XFCE + noVNC return — 4 CPU / 8 GiB, frozen into the Cube template — and
  headed Chrome uses `desktop-chrome-flags` instead. The Linux build of the
  anti-detect binary also freezes a coherent Windows desktop
  identity at compile time (classic UA, Client Hints platform/version,
  reduced `navigator.platform` in `NavigatorBase`, hardwareConcurrency,
  deviceMemory), because sites that fence off Linux read those surfaces
  below any page script. Language and timezone stay with the process
  (`--lang=zh-CN`, `TZ=Asia/Shanghai`) so they stay
  aligned with that identity without a second Chromium rebuild when a
  deployment changes locale.

It replaced Obscura, an independent 30 MB engine chosen for memory, and the
replacement was decided by measurement rather than preference. Two things
were measured that no configuration could fix. Obscura rasterizes text only
from the Liberation fonts embedded in its binary: fonts mounted into
`/usr/share/fonts` and `~/.fonts` changed nothing, the binary carries no font
flag or environment variable, and so every Chinese page screenshots as rows
of boxes — for a deployment whose tenants write Chinese, every screenshot and
PDF was illegible while every command still reported success. And its task
budget refuses heavy pages outright: Wikipedia's main page failed to open
with "autonomous browser task exceeded its task budget". Chromium draws with
the image's own fontconfig stack — the wqy-microhei installed for matplotlib
now serves the browser too — and its screenshots are what the panel's browser
tab shows, polled about once a second over the `/browser` channel
`dsh-sandbox-host` registers. The memory argument that chose Obscura was real and its
price is now paid knowingly: roughly 100 MB idle against 30, and 300–500 MB
with a heavy page open, out of a sandbox's 2–4 GB.

What an agent types is not the protocol but `playwright-cli`, Playwright's own
CLI for coding agents. That choice buys two things at once. It is the interface
an agent already knows, and it ships the skill that teaches it — so this
repository writes no skill of its own, the same arrangement OfficeCLI is under
and for the same reason: a copy kept here would age silently against the pinned
version.

The two halves are joined by a configuration file, and that file is the whole
trick. `playwright-cli open` means "launch a browser" everywhere else; here it
has to mean "use the one already running", which is what `cdpEndpoint` says.
The CLI resolves its configuration as `.playwright/cli.config.json` relative to
the working directory and has no environment variable for it, so the entrypoint
writes it into the tenant's workspace on every boot — rewritten rather than
created once, so an image that moves the port cannot leave a volume pointing at
the old answer.

The desktop image freezes TigerVNC + XFCE + noVNC + headed Chrome into the
Cube template with `create-from-image --cmd /app/sandbox/template-warm.sh`
and `--probe 6099` (Cube 0.7). After restore those processes are already in
memory; `start-desktop.sh` only ensures them. The panel's Computer tab embeds
`/computer/` (session-authenticated noVNC through the tunnel). The light image
still starts headless Chromium from `start-browser.sh` on each backend boot —
idempotent behind a port check — and the watch-only Browser tab polls CDP
JPEGs. Both scripts know no tenant: no identity, no mount, a profile on the
machine's own disk, which is what makes desktop freeze legal and what a
template hook always required.

The browser listens on loopback, and that is load-bearing: a CDP port drives
the browser as the tenant, so anything that can reach it reads what they read
and posts as them. What the engine swap gave up is the other fence, and the
regression is recorded here rather than smoothed over. A browser inside a
sandbox is the classic way to reach what a tenant cannot address — an agent
can be talked into fetching an internal endpoint, and the request leaves from
in here rather than from whoever asked for it. Obscura refused private and
loopback ranges inside the engine; Chromium has no such switch. Under
CubeSandbox that fence is CubeEgress, outside the sandbox. Under plain Docker
nothing enforces it now, and this paragraph is the only place that says so.

`verify/probe-browser-conformance.mjs` still runs the skill's whole command
table against a fixture served inside the sandbox — written for an independent
engine, kept because it is what catches a Chromium build that stops answering
something the skill teaches. It also holds the image's fonts to account: two
screenshots of pages differing only in their Chinese characters must differ as
bytes, because the previous engine passed that whole table while
screenshotting Chinese as tofu. Run the probe when `PLAYWRIGHT_CLI_VERSION`
moves, or when `BROWSER_SOURCE` switches the binary.

## The model plane

A deployment names one model route and every tenant spends their own key on it.
Those are two separate facts, and keeping them separate is what makes this
project's model configuration portable to a deployment that serves something
else entirely.

**The route is configuration, not code.** `MODEL_PROVIDER_ID`, `MODEL_ID`,
`MODEL_API`, `MODEL_COMPAT` and their neighbours describe one endpoint: what it
is called, what protocol it speaks, which model it serves, and the
compatibility switches an OpenAI-compatible gateway needs that nothing can
infer from a URL. `sandbox/cordis.model.patch.yml` builds one provider profile
out of them, as the harness's own default. That layer is applied only when
`MODEL_PROVIDER_ID` is set, and it is a second patch file for exactly that
reason: a patch entry replaces the config it names rather than merging into it,
so applying it with nothing configured overwrites the harness's own default
model with nothing and the backend refuses to boot. A deployment that has named
no model applies no layer and comes up on whatever the harness ships. Nothing
is written into a tenant's
settings: the profile is the base that a tenant's `llm-pi-ai:` section merges
over, per provider, so a change to the deployment's model reaches every sandbox
on its next start — and a tenant who has configured their own keeps it.

The names are the deployment's own and deliberately not a provider's. They were
`DEEPSEEK_*` for a while, which put this deployment's endpoint and key on the
two names DeepSeek's own adapter reads: a tenant who wanted to spend their own
DeepSeek key on DeepSeek's own endpoint had nowhere to put it, because the
deployment was already sitting on that name.

**The key is a claim, not a call.** Keys are made in bulk, outside this
project, wherever the model is metered — one account holding many, each with
its own allowance is the arrangement this deployment uses — and loaded as
opaque strings with `scripts/load-model-keys.mjs`. Registration takes one and
writes it onto the account; everything after that reads a column.

Claiming at registration rather than minting on demand is what keeps somebody
else's API off the sign-in path: a claim is one statement against a table this
deployment owns, and it cannot be slow or down while the sign-in that needs it
is up. It is also why the claim happens in exactly two places — registration
and the operator's backfill — and never on a read. When it ran on reads, every
sandbox creation could spend a key, and a subtly wrong claim did: it took a key
and reported an empty pool, one row per sign-in.

An account with no key falls back to the deployment's own credential, which is
what every sandbox had before pooling. An empty pool is therefore a line in the
log rather than a tenant who cannot work.

**The key does not enter the sandbox.** Under CubeSandbox the sandbox is
started with a placeholder and CubeEgress replaces the `Authorization` header
as the request leaves. Two constraints come with that, and both are load-
bearing enough to have cost a day each: CubeEgress only ever sees traffic on
ports 80 and 443, and only for destinations the host routes plainly — not its
own addresses, which the local routing table claims before the policy rule can
steer them, and not a Docker bridge, which its isolation chains drop. A model
endpoint that fails either test is reachable and uninjectable, so the rule
builder declines to substitute a placeholder for a credential nothing will
replace. `docs/sandbox-pitfalls.md` carries the measurements.

## The sidebar's foot

Two things live there, and which package owns which follows the same question
as everything else: take the gateway away, is this still needed?

The **sandbox row** — a status dot and three rings for CPU, memory and disk —
belongs to `dsh-sandbox-host`, because a sandbox is what it describes. The
figures come from `/proc` and `statfs` inside the sandbox, over the same
`/files` channel the uploads use, polled every five seconds while somebody is
looking. A push would have cost a frame kind in the tunnel protocol and
per-tenant state in the gateway; a poll costs one small round trip and nothing
when no tab is open.

Collapsed to the 56px rail the row renders nothing at all. A lone status dot
was the first cut and it read as a stray mark: with no label beside it nothing
says the colour is about a sandbox, and the three rings it stood in for do not
fit at that width either.

Whether the sandbox is RUNNING is deliberately not part of that answer. A
sandbox that is not running answers nothing at all, and the gateway already
says so with a 503 — so the state is read from whether the call arrives, which
is the only version of the question that is not a guess.

The **account row** belongs to `dsh-tenant-account`, and it takes the seat the
Settings control used to have. That is not a decoration: the shell's Settings
button IS the `settings.trigger` seat, wrapped by the owner in the button that
opens the panel. Filling that seat with the account row is what demotes
Settings from a first-class control to one line in the menu behind it, while
leaving the panel and every section in it untouched. The menu opens the panel
by clicking the owner's own button — `open` is local state inside the settings
shell, with no service and no event to reach it, so the click is the only seam
there is.

## Permissions inside a sandbox

Sandboxes run with `DSH_PERMISSION_MODE=danger-full-access`, which the base
bundle reads for both the file policy and the approval policy: full access, and
no approval prompts. Asking a tenant to approve each write and each command
would be guarding the inside of a box that exists to be written in, and the
prompt has nowhere to appear in a headless container. The boundaries that
matter are the container and the gateway in front of it.

## Isolation

One user gets one sandbox. Nothing multiplexes two users into one dsh process,
because dsh has no tenant concept: its `/api` surface is single-occupancy and
its session store is process-wide. Isolation between tenants is container
isolation, and the gateway allocates every tunnel stream id, so a sandbox can
only answer streams opened for its own tenant.

## Verifying it

```sh
cd verify && ./verify.sh                                 # the Docker simulation
SANDBOX_RUNTIME=cube COMPOSE_FILE=../compose.yml:../compose.cube.yml \
  GATEWAY=https://host:8443 ./verify.sh                  # CubeSandbox
```

It signs two tenants in and checks the properties the deployment exists to
provide: unauthenticated calls and upgrades are refused, each tenant gets their
own sandbox, the backend listens on loopback so the tunnel is the only way to
it, the loopback-pinned configuration methods survive the tunnel rewriting, both
`/api` downlinks open, a real model turn completes, and neither tenant can list,
read, or prompt into the other's sessions. Where the runtime withholds the model
credential, it also checks that the sandbox holds only the placeholder.

It runs against either runtime. Everything it asks about a sandbox goes through
four functions, because the two runtimes share nothing to inspect: under
`docker` a sandbox is a container on the host it runs from, and under `cube` it
is a machine only the gateway container can reach — so those calls go through a
helper copied into it. What it asks is read from the backend process itself
rather than from a shell beside it, since the two runtimes start that process
differently and a shell answered about the wrong one.

It also removes every sandbox and checks that `/` still answers with its boot
manifest, that a client bundle still answers, that an unknown frontend path
404s rather than reaching a sandbox, and that none of it started one — the
property the frontend split exists to provide.

It then drives a real Chromium: sign in, boot the page with no console or page
errors, choose a workspace, send a message, and read the model's answer out of
the DOM. That suite exists because a status code cannot tell a working page
from a blank one — the two failures that actually reached a person, a broken
inline script and a missing boot manifest, were invisible to every HTTP check.

One check starts no sandbox: the idle sweep decides on elapsed time, so it is
driven directly with both of its clocks handed in, rather than waited out for
the length of a TTL.

The `ws`-dependent suites run inside the gateway container. The browser suite
runs on the host when Playwright is installed there and in Playwright's own
image otherwise, which is what lets it run on a deployment host rather than only
on a developer's checkout. Both spend real model tokens.
