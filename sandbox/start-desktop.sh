#!/bin/bash
# Start (or ensure) KDE Plasma X11 + TigerVNC + noVNC.
#
# template-warm.sh cold-starts this tenant-free stack before Cube snapshots it.
# After restore every port/process check becomes a no-op; Docker simulation uses
# the same path without a snapshot.
set -eu

DISPLAY_NUM=0
export DISPLAY=":${DISPLAY_NUM}"
export HOME="${DESKTOP_HOME:-/home/desktop}"
export USER=desktop
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-desktop}"
export XDG_SESSION_TYPE=x11
export XDG_CURRENT_DESKTOP=KDE
export XDG_SESSION_DESKTOP=KDE
export KDE_FULL_SESSION=true
export KDE_SESSION_VERSION=5
export LANG="${LANG:-zh_CN.UTF-8}"
export LANGUAGE="${LANGUAGE:-zh_CN:zh}"
export LC_ALL="${LC_ALL:-zh_CN.UTF-8}"
export TZ="${TZ:-Asia/Shanghai}"

install -d -m 1777 /tmp/.X11-unix
install -d -m 700 -o desktop -g desktop "$XDG_RUNTIME_DIR"

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

desktop_env=(
  HOME="$HOME" USER="$USER" DISPLAY="$DISPLAY"
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" XDG_SESSION_TYPE=x11
  XDG_CURRENT_DESKTOP=KDE XDG_SESSION_DESKTOP=KDE
  KDE_FULL_SESSION=true KDE_SESSION_VERSION=5
  LANG="$LANG" LANGUAGE="$LANGUAGE" LC_ALL="$LC_ALL"
)

if [ ! -S /run/dbus/system_bus_socket ]; then
  install -d -m 755 /run/dbus
  dbus-daemon --system --fork
fi

# ---- TigerVNC ----
# Never probe :5900 with a bare TCP connect. Xvnc treats a connection that
# does not complete the RFB handshake as a failed client and blacklists the
# loopback address after several attempts. A template health loop once froze
# that blacklist into every restored sandbox.
if ! pgrep -u desktop -x Xvnc >/dev/null 2>&1; then
  rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}" 2>/dev/null || true
  setsid nohup runuser -u desktop -- env "${desktop_env[@]}" \
    Xvnc ":${DISPLAY_NUM}" \
      -geometry "${VNC_GEOMETRY:-1280x720}" \
      -depth 24 -rfbport 5900 -SecurityTypes=None -localhost=yes -ac \
      -FrameRate "${VNC_FRAME_RATE:-45}" \
      > /tmp/tigervnc.log 2>&1 < /dev/null &
fi

# X11 readiness is a real protocol exchange and has no effect on VNC's client
# failure counter. It also works for both a cold Docker boot and a restored VM.
for _ in $(seq 1 40); do
  runuser -u desktop -- env DISPLAY="$DISPLAY" xdpyinfo >/dev/null 2>&1 && break
  sleep 0.25
done

# ---- KDE Plasma X11 ----
if ! pgrep -u desktop -x plasmashell >/dev/null 2>&1 \
   && ! pgrep -u desktop -x kwin_x11 >/dev/null 2>&1; then
  # Expanded by the desktop user's inner shell.
  # shellcheck disable=SC2016
  setsid nohup runuser -u desktop -- env "${desktop_env[@]}" \
    KWIN_COMPOSE="${KWIN_COMPOSE:-N}" \
    dbus-run-session -- bash -lc '
      umask 077
      printf "%s\n" "$DBUS_SESSION_BUS_ADDRESS" > "$XDG_RUNTIME_DIR/plasma-bus-address"
      kbuildsycoca5 --noincremental >/tmp/ksycoca.log 2>&1 || true
      balooctl disable >/tmp/baloo.log 2>&1 || true
      (
        for _ in $(seq 1 80); do
          if pgrep -u desktop -x plasmashell >/dev/null \
            && /usr/local/bin/set-desktop-theme \
              "${DESKTOP_THEME_MODE:-auto}" "${DESKTOP_THEME_RESOLVED:-dark}" \
              >/tmp/fluent-theme-switch.log 2>&1; then
            break
          fi
          sleep 0.5
        done
      ) &
      exec startplasma-x11
    ' > /tmp/plasma.log 2>&1 < /dev/null &
fi

# ---- noVNC ----
if ! port_open 6080; then
  if [ -x /usr/share/novnc/utils/novnc_proxy ]; then
    novnc_proxy=/usr/share/novnc/utils/novnc_proxy
  else
    novnc_proxy=/usr/share/novnc/utils/launch.sh
  fi
  setsid nohup "$novnc_proxy" \
    --vnc 127.0.0.1:5900 --listen 127.0.0.1:6080 \
    > /tmp/novnc.log 2>&1 < /dev/null &
  for _ in $(seq 1 40); do
    port_open 6080 && break
    sleep 0.25
  done
fi

exit 0
