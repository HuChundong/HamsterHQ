#!/bin/bash
# Start (or ensure) the XFCE + TigerVNC + noVNC + headed Chrome stack.
#
# Used in two places:
#   template-warm.sh  — cold-starts everything during create-from-image so the
#                       memory snapshot freezes a ready desktop.
#   entrypoint.sh     — after a Cube restore the stack is already in memory;
#                       the port checks below make this a no-op. Under Docker
#                       simulation (no snapshot) the same script cold-starts.
#
# Knows no tenant: no identity, no mount, profile on the machine's own disk.
# That is what makes it legal to freeze into a Cube template.
set -eu

DISPLAY_NUM=0
export DISPLAY=":${DISPLAY_NUM}"
export HOME="${DESKTOP_HOME:-/home/desktop}"
export USER="${USER:-desktop}"
export LANG="${LANG:-zh_CN.UTF-8}"
export LANGUAGE="${LANGUAGE:-zh_CN:zh}"
export LC_ALL="${LC_ALL:-zh_CN.UTF-8}"
export TZ="${TZ:-Asia/Shanghai}"

mkdir -p "$HOME" /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix 2>/dev/null || true

# Clear stale X locks from a previous non-snapshot boot (Docker sim / crash).
rm -f "/tmp/.X${DISPLAY_NUM}-lock" 2>/dev/null || true

chrome_bin() {
  if [ -x /opt/chrome/chrome ]; then
    echo /opt/chrome/chrome
  elif [ -x /usr/local/bin/chrome ]; then
    echo /usr/local/bin/chrome
  elif command -v chromium >/dev/null 2>&1; then
    command -v chromium
  elif command -v google-chrome >/dev/null 2>&1; then
    command -v google-chrome
  else
    echo ""
  fi
}

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# ---- dbus (session bus for XFCE / Chrome) ----
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  # shellcheck disable=SC2046
  eval "$(dbus-launch --sh-syntax)"
  export DBUS_SESSION_BUS_ADDRESS
fi

# ---- TigerVNC ----
if ! port_open 5900; then
  if ! command -v Xvnc >/dev/null 2>&1; then
    echo "start-desktop: Xvnc not installed; skipping desktop stack" >&2
    exit 0
  fi
  setsid nohup Xvnc ":${DISPLAY_NUM}" \
    -geometry "${VNC_GEOMETRY:-1280x720}" \
    -depth 24 \
    -rfbport 5900 \
    -SecurityTypes=None \
    -localhost=yes \
    -ac \
    -AllowOverride=Desktop \
    > /tmp/tigervnc.log 2>&1 < /dev/null &
  # Wait briefly for the display socket.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    port_open 5900 && break
    sleep 0.3
  done
fi

# ---- XFCE ----
if ! pgrep -x xfce4-session >/dev/null 2>&1 && ! pgrep -x xfwm4 >/dev/null 2>&1; then
  if command -v startxfce4 >/dev/null 2>&1; then
    # Portal helps Chrome downloads in a container without systemd activation.
    if [ -x /usr/libexec/xdg-desktop-portal ]; then
      setsid nohup /usr/libexec/xdg-desktop-portal >/tmp/xdg-portal.log 2>&1 < /dev/null &
    fi
    setsid nohup startxfce4 > /tmp/xfce.log 2>&1 < /dev/null &
  fi
fi

# Backdrop: seeded xfce4-desktop.xml may miss the monitor name this Xvnc
# actually registered. Once xfdesktop is up, rewrite every last-image prop.
WALLPAPER=/usr/share/backgrounds/hamsterhq/desktop.jpg
if [ -f "$WALLPAPER" ] && command -v xfconf-query >/dev/null 2>&1; then
  (
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
      pgrep -x xfdesktop >/dev/null 2>&1 && break
      sleep 0.5
    done
    xfconf-query -c xfce4-desktop -l 2>/dev/null | grep '/last-image$' | while read -r prop; do
      xfconf-query -c xfce4-desktop -p "$prop" -n -t string -s "$WALLPAPER" 2>/dev/null \
        || xfconf-query -c xfce4-desktop -p "$prop" -s "$WALLPAPER" 2>/dev/null \
        || true
    done
  ) >/tmp/desktop-wallpaper.log 2>&1 &
fi

# ---- noVNC ----
if ! port_open 6080; then
  NOVNC_PROXY=""
  if [ -x /usr/share/novnc/utils/novnc_proxy ]; then
    NOVNC_PROXY=/usr/share/novnc/utils/novnc_proxy
  elif [ -x /usr/share/novnc/utils/launch.sh ]; then
    NOVNC_PROXY=/usr/share/novnc/utils/launch.sh
  fi
  if [ -n "$NOVNC_PROXY" ]; then
    setsid nohup "$NOVNC_PROXY" --vnc 127.0.0.1:5900 --listen 127.0.0.1:6080 \
      > /tmp/novnc.log 2>&1 < /dev/null &
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      port_open 6080 && break
      sleep 0.3
    done
  fi
fi

# ---- headed Chrome + CDP ----
if ! port_open 9222; then
  bin="$(chrome_bin)"
  if [ -z "$bin" ]; then
    echo "start-desktop: no Chrome binary; CDP will be absent" >&2
    exit 0
  fi
  flags=()
  if [ -f /app/sandbox/desktop-chrome-flags ]; then
    while IFS= read -r flag; do
      case "$flag" in ''|'#'*) continue ;; esac
      flags+=("$flag")
    done < /app/sandbox/desktop-chrome-flags
  fi
  if [ -f /opt/chrome/vk_swiftshader_icd.json ]; then
    export VK_ICD_FILENAMES=/opt/chrome/vk_swiftshader_icd.json
  fi
  setsid nohup "$bin" "${flags[@]}" \
    --remote-debugging-port=9222 \
    --user-data-dir=/tmp/desktop-chrome-profile \
    --disk-cache-dir=/tmp/desktop-chrome-cache \
    --display="$DISPLAY" \
    > /tmp/desktop-chrome.log 2>&1 < /dev/null &
fi

exit 0
