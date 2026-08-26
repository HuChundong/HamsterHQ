#!/bin/bash
# Start the sandbox's browser — once, whoever asks first.
#
# Two callers share this file, and the port check is what lets them. Under
# CubeSandbox it is the template's *start command*: it runs while the template
# is created, the ready command holds the snapshot until 9222 answers, and so
# every sandbox restores with the browser already running — none of its launch
# is spent inside a tenant's cold start. The entrypoint calls it too, and on a
# restored sandbox that call meets a listening port and returns at once; under
# plain Docker, where nothing pre-started it, that same call is the one that
# starts it.
#
# Freezing a running browser into the snapshot is safe by the rule in
# docs/sandbox-pitfalls.md — a template cannot hold anything only knowable
# when a tenant arrives — because nothing here knows one: no identity, no
# mount, a profile on the machine's own disk. Every restore gets an identical
# fresh browser that diverges privately from there.
#
# Loopback only — the default for the debugging port, stated because it is
# load-bearing: CDP drives the browser as the tenant, so anything that can
# reach the port reads what they read and posts as them. Nothing outside this
# machine may. There is no private-network fence any more, and that is a
# regression worth stating where it happened: Obscura refused private ranges
# inside the engine, Chromium has no such switch. Under CubeSandbox the fence
# is CubeEgress, outside the sandbox; under plain Docker nothing enforces it.
# "The browser in the sandbox" in docs/design.md carries the account.
set -eu

# Already listening means already started — restored from the snapshot, or by
# an earlier caller. bash's own /dev/tcp, so the check needs nothing else.
if (exec 3<>/dev/tcp/127.0.0.1/9222) 2>/dev/null; then
  exit 0
fi

# Absent halves mean an image built without the browser; the sandbox should
# still serve its tenant, so this is a quiet no, not a failure.
[ -x /usr/local/bin/headless-shell ] || exit 0
[ -f /app/sandbox/browser-flags ] || exit 0

# The tuning, one flag per line with the reasoning beside each. One home,
# because the conformance probe starts its own browser from the same file and
# must measure what a tenant runs.
flags=()
while IFS= read -r flag; do
  case "$flag" in ''|'#'*) continue ;; esac
  flags+=("$flag")
done < /app/sandbox/browser-flags

# Profile, cache and log on the machine's own disk, deliberately not the
# tenant's mount: no mount exists when the template's start command runs, a
# restored browser must not have its profile shadowed by one arriving later,
# and Chromium's profile is exactly the many-small-files workload a network
# filesystem is worst at. The price is that a rebuilt sandbox starts with a
# fresh browser — cookies are working set, not files.
setsid nohup /usr/local/bin/headless-shell "${flags[@]}" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/browser-profile \
  --disk-cache-dir=/tmp/browser-cache \
  > /tmp/browser.log 2>&1 < /dev/null &
