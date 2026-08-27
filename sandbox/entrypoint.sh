#!/bin/bash
# Start one tenant's dsh backend and the tunnel that reaches it.
#
# bash, not sh: `wait -n` is a bash builtin and the image's /bin/sh is dash.
#
# dsh keeps its default loopback binding: nothing outside this container may
# talk to it, and the tunnel client's loopback-rewritten requests are what carry
# browser traffic in. That is also what keeps the loopback-pinned configuration
# methods (settings.*, credentials.*, agentPreset.*, host.*) reachable.
set -eu

# The image's own environment. Sourced rather than inherited because only one
# of the two ways this is started passes it on: a container gets the image's
# `ENV`, but envd — which starts this under CubeSandbox — hands its processes a
# clean environment instead. Sourcing makes both paths identical, and is a
# no-op on the one that already had it.
# shellcheck source=/dev/null  # written by the image build, absent from the tree
. /app/sandbox/env.sh

# The tenant's own state, all of it under one mount.
#
# One CubeSandbox volume is attached at `/mnt`, backed by a prefix in an
# S3-compatible bucket whose store is a fixed-size filesystem — so a tenant's
# writes are bounded by something other than the host's free space.
#
# THE PATHS DO NOT DEPEND ON WHETHER THAT VOLUME EXISTS. With one, `/mnt` is
# the volume and everything under it survives the sandbox; without one — the
# Docker simulation — `/mnt` is the image's writable layer and it does not.
# That is the only difference. It is written this way on purpose: every path
# that existed only when a volume did, or only when one did not, was a path
# whose failure was discovered in production. The workspace used to be a
# symlink into the volume and a real directory without one, and `find` does
# not follow a symlink named on its command line — so the canvas found nothing
# in production and everything in the simulation.
#
# Nothing is linked or bound out to a second name. Which path the workspace has
# was always ours to choose: dsh takes its workspace root from the working
# directory it is started in, and `DSH_HOME` is an environment variable. So
# both are simply told where they already are.
mkdir -p "$WORKSPACE" "$DSH_HOME"

# The one thing here that belongs to the IMAGE rather than to the tenant.
#
# `profiles/` holds the composed web profile, this project's plugins, and
# `node_modules` linked into /src, and the harness hardcodes its location at
# `$DSH_HOME/profiles` — so a directory that is half the tenant's and half the
# image's is not a choice this can avoid. It is a link back to the image's own
# copy, remade on every boot, so an upgrade can never leave a stale profile or
# a dangling link behind.
#
# It sits inside DSH_HOME and not inside the workspace, which is what keeps it
# out of everything that walks the tenant's files.
ln -sfn "$IMAGE_DSH_HOME/profiles" "$DSH_HOME/profiles"

# env.sh is what the acceptance suite and every probe read to learn the
# environment the backend runs with, and DSH_HOME has just moved. Corrected
# rather than left to disagree.
sed -i "s|^export DSH_HOME=.*|export DSH_HOME=$DSH_HOME|" /app/sandbox/env.sh

# Bring the tenant's data up to the layout this image understands.
#
# The image knows which layout it was built for; the volume records which one
# it was last brought to. Equal is the ordinary case and costs one read of a
# small file — no node process, nothing parsed. Start-up is on the path of
# every request that finds no sandbox, so the common case has to be free.
#
# A volume ahead of the image is refused rather than opened. That happens when
# a deployment rolls back, and the old code would read a layout it does not
# know by rules that no longer hold — losing data quietly where stopping is
# merely loud.
LAYOUT_STAMP="$MOUNT/.dsh-layout"
LAYOUT_AT=$(cat "$LAYOUT_STAMP" 2>/dev/null || echo 0)
case "$LAYOUT_AT" in ''|*[!0-9]*) LAYOUT_AT=0 ;; esac

if [ "$LAYOUT_AT" -gt "$SANDBOX_LAYOUT_VERSION" ]; then
  echo "sandbox: this volume is at layout $LAYOUT_AT and the image understands $SANDBOX_LAYOUT_VERSION;" >&2
  echo "sandbox: refusing to start rather than read newer data by older rules" >&2
  exit 1
fi

if [ "$LAYOUT_AT" -lt "$SANDBOX_LAYOUT_VERSION" ]; then
  if node /app/sandbox/migrate-storage-paths.mjs "$DSH_HOME" "$WORKSPACE" "$LAYOUT_AT" "$SANDBOX_LAYOUT_VERSION"; then
    printf '%s\n' "$SANDBOX_LAYOUT_VERSION" > "$LAYOUT_STAMP"
  else
    # Not fatal: what a failed step costs is the thing it repairs, and the
    # stamp is left behind so the next boot tries again.
    echo "sandbox: layout migration failed; the volume stays at $LAYOUT_AT" >&2
  fi
fi

# The harness as the registry publishes it. DSH is a dependency of this
# deployment rather than part of it, so a tenant runs the same `lib/bin.js` the
# npm package ships as `dsh`, at the version the image was built with.
#
# Started from the tenant's workspace, not from wherever the harness lives. dsh
# takes its sandbox policy's workspace root from the process's working
# directory, so starting it anywhere else would make that directory the tenant's
# workspace — and with full access inside the container, the agent's default
# working directory would have been the harness's own installation.
cd "$WORKSPACE"
# `--no-open` because 0.1.0-rc.8 made `dsh web` open the default browser, and
# this one is a container with no desktop, no DISPLAY and nobody in front of it.
# The browser that reaches this backend is served by the web deployment and
# arrives over the tunnel; there is nothing here to open.
#
# The model layer is a second `--patch` and only when there is a model to
# describe. A patch entry replaces the config it names rather than merging into
# it, so applying that layer with nothing configured overwrites the harness's
# own default provider and model with nothing — and that entry requires a
# provider, so the backend refuses to boot. A checkout that has named no model
# comes up on the harness's defaults instead, which is what it should do.
MODEL_PATCH=""
if [ -n "${MODEL_PROVIDER_ID:-}" ]; then
  MODEL_PATCH="--patch /app/sandbox/cordis.model.patch.yml"
fi
# Unquoted on purpose: empty must expand to no argument at all, and quoted it
# would expand to one empty argument, which `--patch` rejects.
# shellcheck disable=SC2086
node "$DSH_BIN" web --patch /app/sandbox/cordis.patch.yml $MODEL_PATCH --port 3080 --no-open &
DSH_PID=$!

# The reporter: what this machine is doing and what changed in the workspace,
# told to the gateway rather than read out of here by it.
#
# Started beside the backend and not by the gateway, which is the whole point.
# A watch or a sampler started per gateway connection outlives that connection —
# closing the stream tears down the gateway's end and leaves the process here —
# so they accumulated, one per reconnect, for the life of the sandbox. This is
# one process for the life of the sandbox instead, and it decides how often to
# speak from what the gateway tells it about who is listening.
#
# Not waited on: a sandbox whose reporter died should keep serving its tenant,
# and the gateway's own silence timeout is what notices.
if [ -x /usr/local/bin/dsh-agent ]; then
  /usr/local/bin/dsh-agent serve "$WORKSPACE" >/dev/null 2>&1 &
fi

# The browser, started here because the platform offers nowhere earlier:
# cubemastercli template create-from-image takes no start or ready command,
# so it cannot be baked running into the template. The launch rides this boot
# instead — backgrounded inside the script, so the backend never waits on it
# — and the script is idempotent behind a port check, so a backend restarted
# through envd meets the browser running and this call returns at once. The
# script carries its own reasoning (loopback, the lost private-network fence,
# where the profile lives).
#
# Not waited on: a sandbox whose browser died should keep serving its tenant.
/app/sandbox/start-browser.sh || true

# `playwright-cli` resolves its configuration as `.playwright/cli.config.json`
# relative to the working directory, and there is no environment variable for
# it — so the file has to be where the agent starts, which is the workspace.
# Rewritten every boot rather than created once: an image that changes where
# the browser listens must not leave a tenant's volume pointing at the old
# answer.
if [ -f /opt/playwright-cli.config.json ]; then
  mkdir -p "$WORKSPACE/.playwright"
  cp /opt/playwright-cli.config.json "$WORKSPACE/.playwright/cli.config.json"
fi

# The tunnel is a plugin in the composition above, not a second process, so
# there is one thing to wait on and nothing to keep in step with it.
wait "$DSH_PID"
