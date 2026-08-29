#!/bin/bash
# Interactive Chrome for the desktop session (panel / mime / exo-open).
#
# start-desktop.sh already holds CDP on :9222 with this profile; opening a
# URL here should reuse that process. Always pass container-safe flags —
# Debian Chromium and the anti-detect binary both need --no-sandbox here.
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

exec "$REAL" \
  --no-sandbox \
  --disable-dev-shm-usage \
  --user-data-dir=/tmp/desktop-chrome-profile \
  --disk-cache-dir=/tmp/desktop-chrome-cache \
  --no-first-run \
  --start-maximized \
  --lang=zh-CN \
  "$@"
