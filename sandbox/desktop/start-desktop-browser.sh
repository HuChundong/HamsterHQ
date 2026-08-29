#!/bin/bash
# Start the tenant's headed browser on first use and reuse it afterwards.
set -eu
desktop_user="${DESKTOP_USER:-hammy}"
desktop_home="${DESKTOP_HOME:-/home/$desktop_user}"

cdp_ready() {
  curl -fsS --max-time 1 http://127.0.0.1:9222/json/version >/dev/null 2>&1
}

open_existing() {
  [ "$#" -eq 0 ] && return 0
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u "$desktop_user" -- env \
      HOME="$desktop_home" DISPLAY="${DISPLAY:-:0}" \
      CHROME_PROFILE_DIR="${CHROME_PROFILE_DIR:-/mnt/browser-profile}" \
      CHROME_CACHE_DIR="${CHROME_CACHE_DIR:-/tmp/desktop-chrome-cache}" \
      /usr/local/bin/chrome-launch "$@" >/dev/null 2>&1 || true
  else
    /usr/local/bin/chrome-launch "$@" >/dev/null 2>&1 || true
  fi
}

if cdp_ready; then
  open_existing "$@"
  exit 0
fi

# Several agent commands can arrive together. Only the lock holder launches;
# the others wait for the same CDP endpoint instead of racing one profile.
exec 9>/tmp/desktop-browser-start.lock
flock 9
if ! cdp_ready; then
  profile="${CHROME_PROFILE_DIR:-/mnt/browser-profile}"
  # These four files identify one running Chrome process, not a user. A clean
  # VM must not inherit the previous VM's hostname, PID or DevTools port.
  rm -f "$profile/SingletonCookie" "$profile/SingletonLock" \
    "$profile/SingletonSocket" "$profile/DevToolsActivePort"
  if [ "$(id -u)" -eq 0 ]; then
    setsid nohup runuser -u "$desktop_user" -- env \
      HOME="$desktop_home" DISPLAY="${DISPLAY:-:0}" \
      CHROME_PROFILE_DIR="${CHROME_PROFILE_DIR:-/mnt/browser-profile}" \
      CHROME_CACHE_DIR="${CHROME_CACHE_DIR:-/tmp/desktop-chrome-cache}" \
      /usr/local/bin/chrome-launch "$@" \
      > /tmp/desktop-chrome.log 2>&1 < /dev/null &
  else
    setsid nohup /usr/local/bin/chrome-launch "$@" \
      > /tmp/desktop-chrome.log 2>&1 < /dev/null &
  fi
fi

for _ in $(seq 1 80); do
  cdp_ready && exit 0
  sleep 0.25
done

echo "start-desktop-browser: Chrome did not expose CDP" >&2
exit 1
