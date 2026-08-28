# AGENTS.md

English | [中文](AGENTS.zh.md)

How to work in this repository. Each rule is here because breaking it cost
something; [docs/sandbox-pitfalls.md](docs/sandbox-pitfalls.md) has the
receipts.

## DSH is a dependency, and stays one

**Never patch, vendor, or fork the harness.** It arrives from npm at the version
pinned by `DSH_VERSION` in the `Dockerfile`, and what a tenant runs is the
`lib/bin.js` the registry publishes. A change that only works against a modified
harness is not a change this project can ship.

Upgrading is a version bump, a rebuild, and an acceptance run — in that order,
and the acceptance run is not optional. The harness surfaces this project
depends on (`window.__DSH_BOOT__`, `/plugins`, the loopback-pinned configuration
methods) are not versioned APIs, so an upgrade is only known-good once the suite
says so.

If the harness genuinely cannot do what is needed, the answer is an upstream
issue and a documented limitation here — not a patch layer that silently forks.

**There is exactly one exception, and it is `web/patch-loopback.mjs`.** DSH
decides whether the settings plane is reachable from `location.hostname`, so
every tenant of a deployment reached by a domain name keeps no preference at
all — not the theme, not the language, not the conversation settings. The lock
is deliberate upstream and correct there: `trustedHosts` is a DNS-rebinding
fence, not authentication, so the configuration plane stays loopback-only until
a real authentication layer exists. This deployment is that layer, and the
tunnel already makes the server accept these writes; only the browser declines
to send them. Configuration cannot express it, composition cannot reorder around
it, and flipping the flag from a plugin lands after `ui-theme` has already
bound. The script carries the full argument and the evidence for each of those.

Two things keep it from becoming a habit. It fails the image build when it stops
matching, rather than letting a release ship with settings quietly back in
memory; and `scripts/check-images.sh` asserts it against the bytes nginx will
serve. **Add nothing beside it.** A second patch is a sign this project has
started forking the harness, which is the thing the rule above exists to
prevent — and the first one is only here because upstream is closed to it.

## Everything added to DSH is a cordis plugin

Which plugin a change belongs in is decided by one question: **take the
gateway away — is this still needed?** Six plugins sit on that question
today:

- `dsh-gateway-tunnel` carries a sandbox's `/api` traffic out to the gateway.
  It follows the transport.
- `dsh-sandbox-host` supplies what a browser needs when the backend is on a
 machine the person cannot reach: the `/files` upload channel, the settings
 document read back instead of handed to a desktop that is not there, and the
 `/browser` channel that watches the sandbox's own headless browser. Every
 line of it survives the gateway's removal, which is why it is not more surface
 on another plugin — and why it would be usable by anyone running dsh remotely.
- `dsh-tenant-account` is who is signed in, how to sign out, and the onboarding
  steps a deployment with its own sign-in page has already said. None of it
  means anything without the gateway.
- `dsh-artifact-panel` is the workspace beside the conversation — files,
  viewers, a terminal and a canvas.
- `dsh-scheduled-tasks` is a tenant's schedule: the tools that write one, the
  timers that fire it, and the control in the sidebar's foot. The durable list
  is the gateway's, so none of it survives the gateway's removal.
- `dsh-brand` is this deployment's marks inside the shell.

The other three packages in `packages/` are not plugins: `dsh-icons` and
`dsh-ground` serve surfaces that have no module table, and `tunnel-protocol`
is the frame both ends of the tunnel speak.

A change that fits none of the six is a sign the question above has a new
answer, not that one of them should grow a second subject —
`dsh-gateway-logout` was renamed when it had three.

Four rules, each of which has broken:

- **Name plugins, never paths.** `cordis.patch.yml` refers to a plugin by
  package name. The client-module registry resolves a plugin's `package.json`
  from the config tree's baseUrl and scans only what it can resolve by name — a
  path-loaded plugin mounts its host half and contributes **no client half at
  all**, silently.
- **Install into the profile, not into `/app`.** Node resolves a plugin's own
  dependencies by walking up from where the plugin is, which never reaches
  `/app/node_modules`.
- **Use `--install-links`.** `npm install <local path>` symlinks back to the
  source, and Node then resolves the plugin's dependencies from the link target
  rather than from the profile.
- **Depend on siblings.** A plugin's dependency on another package in
  `packages/` is `file:../<name>`. Deeper relative paths only hold if every
  image copy reproduces the tree's depth, and one did not.

None of these fail the build. All of them fail on the first `import`, which is
what `scripts/check-images.sh` exists to catch.

## Do not implement somebody else's protocol

**If an official client exists for a wire protocol, use it.** envd — the
daemon every sandbox platform in this family embeds — is spoken through its
official client. Do not reimplement the wire protocol. If the official client
cannot do what is needed, the answer is an upstream issue and a documented
limitation here.

The official client cannot send a `Host` header — `Host` is forbidden in
fetch — and the proxy's virtual-host routing needs one. The proxy also routes
by path, which is the address the standard client can use.

Three things are deliberately NOT taken from that client, and each has a
reason that outlives whoever reads this:

- `files.watchDir` — envd cannot watch a network filesystem, and a tenant's
  workspace is one. The sandbox's own Rust watcher exists for that.
- `getMetrics` — polling per sandbox is what the push model replaced. Two
  thousand sandboxes make a poll a load problem.
- `pause`/`resume` — persistence is external, so destroying a sandbox loses
  the working set and not the files. Pausing is a later decision, not a
  missing migration.

`verify/probe-e2b-conformance.mjs` measures what the configured platform
actually does, rather than what it says it does, and names the divergences
already adapted to. It creates a real sandbox against a real platform, so it
lives beside the acceptance suite rather than in `scripts/`, and it is run by
hand when a platform is being considered rather than on every commit.

### No backticks inside a rendered template

Every page in this repository is written as template literals holding markup,
CSS and script — one `return \`…\`` for the page, and a constant beside it for
a stylesheet or a script long enough that the markup cannot be found past it. A backtick in prose inside that template — a comment naming a CSS
property, a path, a variable — ends the string there. What follows is parsed as
expressions, so the function stops returning a document and starts returning
whatever that arithmetic came to: `NaN`, or a `SyntaxError` if you are lucky.

Write a comment, name a thing in backticks out of habit, and the page comes
back blank. Say the name without them.

`check-pages.mjs` catches it — it renders every page and a page that came back
as a number is not a string — but only once it is run. `node --check` catches
the loud half sooner.

### The one protocol written out here

TOTP, in `admin/totp.js`. RFC 6238 has no wire format, no negotiation and no
versioning — it is one HMAC and a modulo — so a dependency for that
`node:crypto` arithmetic would be the larger liability.

The price of the exception is `check-totp.mjs`, and the reason it is not
optional: an authenticator app is an offline calculator. Nothing between it and
this service can report a disagreement, so an implementation that is subtly
wrong is indistinguishable from a right one until somebody with a phone cannot
get in. Testing it against a second implementation proves nothing — both can
misread the same sentence the same way. It is tested against the vectors
printed in the RFC, which is what "works with Google Authenticator" actually
means.

**If you write out somebody else's algorithm, test it against that
specification's own published answers, not against your own reading of it.**

## Icons come from the harness

**Do not draw an icon that `@deepseek-ai/dsh-client-ui-primitives` already
carries.** It has 70, MIT, and every browser half of every plugin can `require`
it from the shell's module table exactly the way it requires React. A window
may hold only one icon style: the harness's filled 16-grid outlines. Drawing a
second set beside them is the thing this rule exists to prevent.

What the harness has no drawing for lives in `packages/dsh-icons`: 21 glyphs,
written as path data by `extract.mjs` from lucide-static and stamped with the
version they came from. Attribution is in [NOTICE](NOTICE).

Lucide because of the two measures that decide whether a glyph belongs beside
another. Its line weighs 2/24 of its box against the harness's 1.3/16 — two per
cent apart, which is why a 24-grid set can stand in a 16-grid interface with
nothing rescaled. And it is stroked rather than solid, which is the harness's
own construction expressed the other way round; `extract.mjs` refuses a glyph
whose weight drifts more than a tenth from upstream's. lucide-static is ISC.

Two traps, both of which cost a rebuild to find. Lucide draws with the whole
primitive vocabulary — a head is a `<circle>`, a frame is a `<rect>` — so an
extractor that reads `d` attributes drops parts of a drawing **without saying
so**: `users` arrived as a body with no head and nothing failed. And a name
that matches is not a meaning that matches, in both directions: `copy` and
`copy-text` are two buttons side by side and must not become one glyph, while
the harness's own `IconCodeOutline16` draws a hash. Read the drawing, not the
name.

Two surfaces cannot require the harness set, and they are the reason that
package exists rather than being only a handful of paths. The gateway's pages
are Node writing HTML into template literals and the landing page is a static
document; neither has a module table or a React runtime, so both take markup
from `dsh-icons` instead. A `DSH_VERSION` bump that did not come back through
the generators fails `check-icons.mjs`.

Two client halves — `dsh-tenant-account` and `dsh-sandbox-host` — each carry
one drawn glyph inline. That is not a preference: the shell's module loader reads
those files as source with `require` bound to its own table, so there is no
build step to resolve a sibling package through. `check-icons.mjs` holds those
bytes to the original.

## Directories mean something

```
Dockerfile              every image, one npm install
gateway/  web/  sandbox/  admin/  scheduler/   one directory per image
packages/               npm packages this repository owns
integrations/           stands alone; could leave without changing a line here
verify/                 the acceptance suite — needs a deployment
scripts/                repository gates — need only the tree or the images
docs/                   design notes and pitfalls, English default
dev/                    the development mailbox; never beside real people
vendor/                 carried here because it is not published
```

The rules that are not obvious from the listing:

- **`integrations/` imports nothing from this repository.** A thing in there
  talks only to the platform it integrates with, so it can move to its own
  repository without a line changing. `cube-volume-juicefs` is a CubeSandbox
  VolumePlugin: it knows about CubeSandbox and JuiceFS, and nothing about
  HamsterHQ. If something in `integrations/` needs to reach into this project,
  it is not an integration and belongs elsewhere.
- **`packages/` holds packages, named for themselves.** The directory name is
  the package name, because `cordis.patch.yml` refers to the package and a
  reader should not have to map between the two.
- **`gateway/` carries no harness code.** It authenticates every tenant and
  holds the Docker socket, which is host-root-equivalent. Adding
  `@deepseek-ai/*` to it puts a tenant's runtime inside the one process that
  must not run tenant code; CI asserts its absence.
- **`scripts/` may not need a deployment; `verify/` may.** A check that can be
  decided from the tree or the built images belongs in `scripts/` and runs in
  CI. A check that needs a live deployment, a CubeSandbox installation, or real
  model tokens belongs in `verify/` and runs against a deployment.

## What to run before a pull request

**Nothing is pushed to `main`.** Every change arrives as a pull request whose
checks passed and is squashed on merge; the server refuses the push for
everyone, including whoever owns the repository.
[CONTRIBUTING.md](CONTRIBUTING.md) has the route, the branch names, and why the
pull request's own title and description are the commit message `main` ends up
carrying.

One command holds every invariant the tree can decide — the lint, the plugin
load, the language, asset and icon checks:

```sh
npm run check                  # scripts/check.sh: the tree-side list
scripts/check-images.sh        # after a build: what resolves, and what loads
```

A single check while iterating on what it covers is still one file:
`node scripts/check-docs.mjs`. `scripts/check.sh` is the one list of tree-side
gates; a gate added there is a gate the pre-commit hook and CI both run. CI
also runs shellcheck, compose-file validation, a credential scan, and a
separate job that builds the images and runs `scripts/check-images.sh`.

**A change to behaviour needs the acceptance suite, against a real deployment:**

```sh
cd verify && SANDBOX_RUNTIME=cube COMPOSE_FILE=../compose.yml:../compose.cube.yml \
  GATEWAY=https://host:8443 ./verify.sh
```

It signs in as the addresses it is given and no others, and **never point one at
a person's real address** — the suite reads verification codes straight out of
the database, so doing so signs in as them and leaves sessions under their
identity.

The console checks no longer take an address at all. The console is its own
service with its own credential, so the suite mints an operator session inside
it rather than borrowing an administrator's. `VERIFY_ADMIN_URL` says where that
service is, defaulting to `http://localhost:8091`; with no admin service running
those two checks are skipped.

It spends real model tokens and removes every sandbox, so it belongs on a
deployment you are willing to disturb. CI cannot run it, which is exactly why a
green CI is not evidence that a behaviour change works.

Changing the sandbox image also means a new CubeSandbox template — a template is
a snapshot taken at creation, so pointing an existing one at a new image leaves
every sandbox restoring the old snapshot. See "Running on CubeSandbox" in the
[README](README.md).

## The deployment tracks the repository

A deployment host is a checkout, not a copy. It updates with `git pull`, which
is also what makes "which commit is running there" a question with an answer —
the previous arrangement was rsync from a laptop, and the host silently held a
`verify.sh` two commits behind the fix it needed.

```sh
ssh <host> 'cd /path/to/hamsterhq && git pull --ff-only'
```

Read-only access is a GitHub deploy key on the host; nothing there can push.
`.env` and `sandbox/egress-ca/*.crt` are gitignored and belong to the host, so a
pull never touches them.

**A pull is not a deployment.** What tenants run is the images, and under
CubeSandbox the template built from them — so a change to anything under
`gateway/`, `web/`, `sandbox/`, `admin/`, or `packages/` reaches nobody until
it is rebuilt, and a sandbox change also needs a new template. A change to `verify/`,
`scripts/`, or `docs/` takes effect on pull alone.

**A rebuild is not one either.** `docker compose build` moves the `:latest` tag;
a container already running keeps the image it was created from, and `stop` then
`start` restarts that same container. Use `up -d` — which recreates a container
whose image has moved — and never `restart` or `stop`/`start` after a build.
Nothing warns about this: the build succeeds, the service comes back healthy,
the logs look right, and the old code is still serving. Check the container
against the tag when it matters:

```sh
docker inspect <container> --format '{{.Image}}'   # must equal
docker images -q --no-trunc <image>:latest
```

**Run the gates before committing, not after.** `git config core.hooksPath
.githooks` enables a pre-commit hook, which runs `scripts/check.sh` — the same
tree-side list CI starts with, and fast enough to run every time. It is there for one mistake
made five times — prose written into a template literal
with a backtick in it, which ends the string and breaks the file. Every time,
one of those checks would have said so in under a second, and twice it was
committed and pushed anyway because the output had scrolled past.

**Building `web` does not move the sandbox tag.** The `shell` stage is
`FROM sandbox`, so building `web` builds the sandbox stage and the browser
halves of the plugins reach nginx — while `hamsterhq-sandbox:latest` keeps
pointing at whatever it pointed at before, and the CubeSandbox template keeps
pointing at an older tag still. A plugin therefore lives in two places at once,
and building only `web` updates one of them. That is fine for a change to a
`client.js`, which the browser fetches from nginx; it silently does nothing for
a change to a plugin's node half, which runs inside the sandbox. Check rather
than assume:

```sh
docker inspect hamsterhq-sandbox:latest --format '{{.Created}}'   # against
docker inspect hamsterhq-web:latest --format '{{.Created}}'
```

To align them: `--profile build build`, tag and push the sandbox image, create a
NEW template from it (never update the old one — a template is a snapshot taken
at creation), point `CUBE_TEMPLATE_ID` at the new alias, and `up -d`.

**`down -v` reaches further than this deployment.** The postgres volume holds
accounts, and on a host where JuiceFS was installed against the same database
server it holds the volume filesystem's metadata too — which is not a copy of
tenants' files but the only record of where they are. Removing it leaves the
object store full of blocks nothing can name, wedges the shared mount, and
turns every sandbox creation into a `408` that mentions none of this. Check
before removing volumes, not after:

```sh
docker exec <postgres> psql -U <user> -d postgres -tAc \
  "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')"
```

Anything there that the deployment did not create is somebody else's, and this
project's own `db.js` creates exactly one.

## Where a rule belongs

There is more than one place to write something down, and a rule in the wrong
one is a rule that gets read too late or not at all. Four homes, decided by what
the writing is rather than what it is about:

- **This file** carries what a change needs in context before it is written: the
  rule, and the name of the check that fails when it is broken. It is read every
  session, so length here is a cost everything else pays.
- **A directory's `AGENTS.md`** carries what is true of that directory and is
  not already true here. `gateway/AGENTS.md` says how a page and a route are
  built in `gateway/`; it does not restate that the gateway carries no harness
  code, because this file already does.
- **[docs/design.md](docs/design.md)** carries reasoning that outlives the code
  — why the shape is this shape, what the alternative cost.
  **[docs/sandbox-pitfalls.md](docs/sandbox-pitfalls.md)** carries a failure
  that cost debugging time, including the wrong conclusion that preceded the
  right one.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** carries the route a change travels, not
  what makes it correct.

Two rules about the writing itself, and they are the ones that decay:

**One home per fact.** A fact restated in a second file does not stay a copy; it
becomes two statements that disagree, and the reader cannot tell which is
current. Link the home instead of repeating it — a directory file that opens by
summarising this one has already started.

**A rule names what enforces it.** Most of the rules here end by naming a script
in `scripts/` because that is what makes them survive being forgotten: the
prose says what is true, and the check says so again the moment it stops being
true. A new invariant with nothing behind it is a preference, and it will drift
like one. If it can be decided from the tree, it goes in `scripts/` and into the
one list in `scripts/check.sh`; if it cannot, say in the prose that nothing
enforces it, so the next reader knows to look with their own eyes.

## Documentation

Every page is a pair: `X.md` in English and `X.zh.md` in Chinese, each linking
to the other, with the same `##` sections in the same order. English is the
default and the one a reader lands on. `scripts/check-docs.mjs` enforces all of
it.

`CLAUDE.md` is a symlink to `AGENTS.md` beside every one of them, for the tools
that look for that name — **edit the real file.** `check-docs` skips symlinks
rather than pairing them, since they are the same bytes under a second name.

Write what is true now. Rationale that outlives the code goes in
[docs/design.md](docs/design.md); a failure that cost debugging time goes in
[docs/sandbox-pitfalls.md](docs/sandbox-pitfalls.md), **including the wrong
conclusion that preceded the right one** — that is the part a reader cannot
reconstruct from the code.

Prefer the measurement to the adjective. "38 ms per small-file create against
0.06 ms on local disk" survives a rewrite; "slow" does not.

## Secrets

`.env.example` is the only member of its family in the tree; `.gitignore`
covers `.env` and `.env.*`, and CI fails on a tracked environment file or on
anything shaped like a credential. Every CubeEgress installation generates its
own root CA, so `sandbox/egress-ca/*.crt` is gitignored and dropped in by the
operator.

The model credential is deployment-owned and reaches a sandbox only under
CubeSandbox, where CubeEgress substitutes it in flight. Nothing should ever put
it into a sandbox's environment, a log line, or a session event.
