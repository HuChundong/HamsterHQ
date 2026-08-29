#!/bin/bash
# Interactive Chrome for the desktop session (panel / mime / agent).
#
# The profile is tenant state and lives on the persistent mount. HTTP/media
# cache is expendable working data and stays on the VM's /tmp. The higher-level
# start-desktop-browser command owns process reuse and readiness; this file is
# the one low-level Chrome invocation shared by every caller.
set -eu

if [ -x /opt/chrome/chrome ]; then
  REAL=/opt/chrome/chrome
elif [ -x /usr/bin/chromium ]; then
  REAL=/usr/bin/chromium
elif [ -x /usr/bin/chromium-browser ]; then
  REAL=/usr/bin/chromium-browser
else
  echo "chrome-launch: no Chrome binary" >&2
  exit 127
fi

if [ -f /opt/chrome/vk_swiftshader_icd.json ]; then
  export VK_ICD_FILENAMES=/opt/chrome/vk_swiftshader_icd.json
fi

profile="${CHROME_PROFILE_DIR:-/mnt/browser-profile}"
cache="${CHROME_CACHE_DIR:-/tmp/desktop-chrome-cache}"
umask 077
mkdir -p "$profile" "$cache"

flags=()
while IFS= read -r flag; do
  case "$flag" in ''|'#'*) continue ;; esac
  flags+=("$flag")
done < /app/sandbox/desktop-chrome-flags

exec "$REAL" \
  "${flags[@]}" \
  --remote-debugging-port=9222 \
  --user-data-dir="$profile" \
  --disk-cache-dir="$cache" \
  "$@"
