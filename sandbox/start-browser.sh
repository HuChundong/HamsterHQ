#!/bin/bash
# Start the sandbox's browser — once, whoever asks first.
#
# The caller is the entrypoint, and a backend boots more than once in a
# machine's life — the gateway restarts it through envd, recovery starts it
# by hand — so the port check is what keeps a second boot from spawning a
# second browser beside the first.
#
# This was written to be a CubeSandbox template's start command, baking a
# running browser into the snapshot so a restored sandbox would meet it
# already listening. cubemastercli template create-from-image turned out to
# carry no start or ready hook, so the launch rides the first backend boot
# instead — backgrounded below, costing the tenant nothing they wait on. The
# script keeps the shape the hook would need — it knows no tenant: no
# identity, no mount, a profile on the machine's own disk — so if the CLI
# grows one, point it here and nothing changes.
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

# Already listening means already started, by an earlier boot of the same
# machine. bash's own /dev/tcp, so the check needs nothing else.
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
# tenant's mount: the browser may start before the mount settles and a mount
# arriving later must not shadow a running browser's files, and Chromium's
# profile is exactly the many-small-files workload a network filesystem is
# worst at. The price is that a rebuilt sandbox starts with a fresh browser —
# cookies are working set, not files.
#
# VK_ICD_FILENAMES points SwiftShader at the ICD the anti-detect image ships
# beside the binary. Absent under the Playwright shell build — the directory
# is not there — and that is fine: the WebGL flags then find nothing and the
# shell still serves pages.
if [ -f /opt/chrome/vk_swiftshader_icd.json ]; then
  export VK_ICD_FILENAMES=/opt/chrome/vk_swiftshader_icd.json
fi

# Timezone is not a Chromium compile flag: ICU reads the process environment.
# Asia/Shanghai matches the frozen zh-CN Windows identity the anti-detect
# binary reports for UA and Client Hints.
export TZ="${TZ:-Asia/Shanghai}"

setsid nohup /usr/local/bin/headless-shell "${flags[@]}" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/browser-profile \
  --disk-cache-dir=/tmp/browser-cache \
  > /tmp/browser.log 2>&1 < /dev/null &
