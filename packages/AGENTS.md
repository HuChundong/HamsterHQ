# AGENTS.md — packages/

English | [中文](AGENTS.zh.md)

Six plugins and three packages that are not. Which plugin a change belongs in,
the four installation rules that fail on the first `import`, and why the
directory name is the package name are in the [root file](../AGENTS.md).

## Which half a file is

A plugin has two halves that run in different places and are written under
different rules.

**The host half** is `index.js`, running in Node inside the sandbox. It exports
`name`, an `apply()`, and `inject` when it needs a service. `apply()` is required
even when it is empty: without it the registry does not mount the plugin, and
then the browser half is never served either — a plugin that does nothing at all
is how an empty `apply()` reads, and it is load-bearing.

**The browser half** is `client.js`, and it is not a module Node ever resolves.
The client-module registry serves it verbatim: nothing resolves through
`node_modules`, there is no build step, and `require` inside it is the shell's own
module table — which is where React comes from.

Three consequences that are easy to get wrong:

- `require` only reaches what the shell's table carries. Asking for anything else
  throws at load time, and the failure is the whole plugin, not the feature: a
  reference error in one file takes the plugin down with it.
- **A sibling package cannot be imported.** There is no bundler to resolve
  `dsh-icons`, which is why `dsh-tenant-account` and `dsh-sandbox-host` each carry
  one glyph inline as path data.
- One file, deliberately. A second file would be a second module the shell never
  fetches.

`dsh-gateway-tunnel` has no browser half at all, which is why it is the one
plugin absent from the harvest composition.

## The one package with a build, and why

`dsh-artifact-panel` is the exception: it needs xterm, and the shell's module
table carries React and nothing else it could use. So it is bundled with esbuild
into `lib/client.js` as an IIFE with `require` left external, and it declares that
output as its client entry in `package.json`.

`lib/` is gitignored — it is derived — and `scripts/check.sh` builds it before
running any check, because `check-plugin-load` reads the served file and would
otherwise read the one from last time. A change to the panel's source that is not
rebuilt is a change no check has seen.

Every other package here is source as published, and adding a bundler to a second
one should be argued rather than assumed.

## The two checks that read every package

`scripts/check-plugins.mjs` reads every `client.js` for the things a
half-translated interface does not report about itself:

- Chinese may appear only inside `DICTIONARY`. A visible string anywhere else is
  a string the language toggle cannot reach.
- Every entry has both `zh` and `en`, non-empty, and every `t('key')` matches the
  dictionary in both directions — an orphan key and a missing key are both
  failures.
- A component calling `t()` must hold `const t = useT()`. A class component
  cannot hold a hook, so it uses `say()` instead; a component that calls `t()`
  without either passes every other check and throws `t is not defined` on first
  render.
- No visible Chinese as a DOM selector, because translating the string then
  breaks the query.

`scripts/check-plugin-load.mjs` executes the served client in a vm with a stubbed
`require`, and requires that it imports without throwing, registers its loader
entry, exports an `apply()`, and gives an array for `inject`. It exists because a
plugin that fails to load takes the page with it, and the error a tenant sees
names a variable rather than a plugin.

A new plugin also touches, in this order: `sandbox/cordis.patch.yml` by package
name, `sandbox/harvest.patch.yml` if it has a browser half worth baking into the
shell, the `Dockerfile` for the `--install-links` install into the profile, and
`scripts/check-images.sh` if its dependencies must resolve from there. Then a
rebuild — of the sandbox image and, for a client change, of `web` as well.

Host API packages are peers of a plugin, not a second harness installation.
The image resolves the scheduled plugin's tools peer to the host's existing npm
module. `check-dockerfile.mjs` keeps its declared version aligned with the pin,
and `check-images.sh` requires both resolutions to reach the same module;
duplicating scope Symbols makes preset registration global by mistake.
