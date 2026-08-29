#!/bin/bash
# CubeSandbox template build entry: freeze a ready desktop into the snapshot.
#
# Passed as create-from-image --cmd. Starts the tenant-free desktop stack and a
# tiny HTTP probe Cube waits on (--probe 6099), then execs cube-entrypoint so
# envd is part of the same snapshot. Without that last step, --cmd replaces the
# image ENTRYPOINT and the template comes up with no envd — every gateway call
# into the sandbox then answers 502.
#
# Never starts dsh, the tunnel, or the reporter — those need a tenant and are
# started later by entrypoint.sh through envd.
set -eu

export DESKTOP_USER="${DESKTOP_USER:-hammy}"
export DESKTOP_HOME="${DESKTOP_HOME:-/home/$DESKTOP_USER}"
export HOME="$DESKTOP_HOME"
export USER="${USER:-$DESKTOP_USER}"

# This file is the final visible-desktop readiness marker. It must be written
# by this boot's theme application, never inherited from an earlier layer.
rm -f "$HOME/.config/dsh-desktop/theme-state"

# Warm only the executable's file pages. Chrome itself stays stopped: its
# profile belongs to a tenant mount that does not exist while this tenant-free
# template is being prepared.
if [ -x /opt/chrome/chrome ]; then
  cat /opt/chrome/chrome >/dev/null 2>&1 || true
  find /opt/chrome -name '*.so*' -type f -exec cat {} + >/dev/null 2>&1 || true
fi

/app/sandbox/start-desktop.sh || true

# Probe stays up beside envd until Cube takes the snapshot.
node /app/sandbox/desktop-health.mjs &

# Hand off to the image entrypoint so envd is frozen into the template the
# same way a light create-from-image (no --cmd) would freeze it.
exec /usr/local/bin/cube-entrypoint.sh
