# AGENTS.md — sandbox/

English | [中文](AGENTS.zh.md)

What a tenant's backend is made of. That a change here needs a new CubeSandbox
template rather than a retagged image, and that envd is spoken through its
official client, are in the [root file](../AGENTS.md).

## No CMD, and the order that follows from it

This image starts nothing. A CubeSandbox template is a snapshot of the image
*running*, so a backend started by the image would be a backend frozen into every
snapshot; the gateway starts `entrypoint.sh` through envd's process API instead.

The order in that script is not incidental:

1. `source /app/sandbox/env.sh`, because envd does not hand a process the image's
   own `ENV`.
2. Create the workspace and `DSH_HOME`, and symlink the image's profiles into the
   tenant's — the profiles are image content, the workspace is the tenant's.
3. Check the layout version and migrate. `SANDBOX_LAYOUT_VERSION` and
   `migrate-storage-paths.mjs` move together; a layout change in one without the
   other leaves a tenant's files where nothing looks for them.
4. Start dsh in the background.
5. Start the reporter in the background, if it is there.
6. `wait` on dsh, and only on dsh.

The tunnel is a plugin inside that composition, not a second process, so there is
one thing to wait on and nothing to keep in step with it.

**A resident process added here goes after dsh and before the `wait`, and is not
waited on.** A sandbox whose reporter died should keep serving its tenant; the
gateway's own silence timeout is what notices.

## The reporter is Rust, and the image checks that it runs

`agent/` builds `dsh-agent`: metrics, an inotify watch over the workspace, and
the reporter that carries both to the gateway. It exists because envd cannot
watch a network filesystem and a tenant's workspace is one.

What you need to know to change it:

- It is built in the `agent-build` stage with `cargo build --release --offline`,
  so a new crate needs its vendored source, not just a `Cargo.toml` line.
- The `sandbox` stage runs the binary and greps for `unknown command`. That is
  the architecture check: a binary built for the wrong one fails with `exec
  format error`, and this catches it in the build rather than in a tenant's
  sandbox.
- `dsh-agent watch <dir>` runs the watcher alone, printing JSON lines. That is
  how to see what it emits without a gateway.
- There is no `cargo test` in this repository. The panel path logic that consumes
  these events is tested on the JavaScript side by
  `scripts/check-panel-paths.mjs`, so a change to the Rust is verified by running
  it, and nothing will tell you otherwise.

Editing the Rust and rebuilding only `web` leaves the old binary in the sandbox
image, which is the trap the root file describes from the other direction.

## Two compositions, and the CA the operator drops in

Three patch files, and which one a plugin belongs in is not interchangeable:

- `cordis.patch.yml` is what a tenant's sandbox runs. `dsh-gateway-tunnel` is
  here and nowhere else.
- `harvest.patch.yml` is build-time only, for harvesting the static shell.
  `dsh-brand` is here and **not** in the runtime composition, because the shell
  the browser loads already carries it.
- `cordis.model.patch.yml` is a second layer applied only when
  `MODEL_PROVIDER_ID` is set.

A plugin put in the wrong file loads for nobody, or loads twice, and neither says
so at build time.

`egress-ca/` holds the CubeEgress root CA, which every installation generates for
itself, so the certificates are gitignored and the operator copies one in. The
image installs it with `update-ca-certificates` — and then also sets
`NODE_EXTRA_CA_CERTS`, because Node verifies against its own bundled roots and
ignores the system store entirely. Without both, a sandbox gets certificate
errors where it expected model responses.
