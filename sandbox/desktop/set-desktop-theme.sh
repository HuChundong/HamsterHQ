#!/bin/bash
set -euo pipefail

mode=${1:-}
resolved=${2:-${DSH_RESOLVED_COLOR_SCHEME:-}}

case "$mode" in
  light|dark) resolved=$mode ;;
  auto)
    case "$resolved" in
      light|dark) ;;
      *) echo "auto mode requires a resolved light or dark preference" >&2; exit 2 ;;
    esac
    ;;
  *) echo "usage: set-desktop-theme light|dark|auto [light|dark]" >&2; exit 2 ;;
esac

desktop_user=${DESKTOP_USER:-hammy}
export HOME=${HOME:-/home/$desktop_user}
export DISPLAY=${DISPLAY:-:0}
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/tmp/runtime-desktop}

bus_address_file="$XDG_RUNTIME_DIR/plasma-bus-address"
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -r "$bus_address_file" ]; then
  export DBUS_SESSION_BUS_ADDRESS
  DBUS_SESSION_BUS_ADDRESS=$(cat "$bus_address_file")
fi

if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  echo "Plasma session bus is not available" >&2
  exit 1
fi

case "$resolved" in
  light)
    color_scheme=FluentLight
    plasma_theme=Fluent-round-light-solid
    look_and_feel=com.github.vinceliuice.Fluent-round-light-solid
    icon_theme=Fluent
    cursor_theme=Fluent-cursors
    widget_style=kvantum
    kvantum_theme=Fluent-round-solid
    decoration=__aurorae__svg__Fluent-round-light-solid
    wallpaper=/usr/share/wallpapers/Fluent-round-light/contents/images/3840x2160.png
    ;;
  dark)
    color_scheme=FluentDark
    plasma_theme=Fluent-round-dark-solid
    look_and_feel=com.github.vinceliuice.Fluent-round-dark-solid
    icon_theme=Fluent-dark
    cursor_theme=Fluent-dark-cursors
    widget_style=kvantum-dark
    kvantum_theme=Fluent-round-solidDark
    decoration=__aurorae__svg__Fluent-round-dark-solid
    wallpaper=/usr/share/wallpapers/Fluent-round-dark/contents/images/3840x2160.png
    ;;
esac

plasma-apply-colorscheme "$color_scheme"
plasma-apply-desktoptheme "$plasma_theme"
kvantummanager --set "$kvantum_theme"
kwriteconfig5 --file kdeglobals --group KDE --key LookAndFeelPackage "$look_and_feel"
kwriteconfig5 --file kdeglobals --group KDE --key widgetStyle "$widget_style"
kwriteconfig5 --file kdeglobals --group Icons --key Theme "$icon_theme"
kwriteconfig5 --file kcminputrc --group Mouse --key cursorTheme "$cursor_theme"
kwriteconfig5 --file kwinrc --group org.kde.kdecoration2 --key library org.kde.kwin.aurorae
kwriteconfig5 --file kwinrc --group org.kde.kdecoration2 --key theme "$decoration"

qdbus org.kde.KWin /KWin org.kde.KWin.reconfigure || true
dbus-send --session --type=signal /KGlobalSettings \
  org.kde.KGlobalSettings.notifyChange int32:2 int32:0 || true

# Fluent's layout initializes a centered, content-width panel. The VM desktop
# must use the complete 1920-wide Windows-like taskbar regardless of theme.
qdbus org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript \
  'var ps=panels();for(var i=0;i<ps.length;i++){var p=ps[i];var g=screenGeometry(p.screen);p.alignment="left";p.offset=0;p.minimumLength=g.width;p.maximumLength=g.width;}'
plasma-apply-wallpaperimage "$wallpaper"

state_dir="$HOME/.config/dsh-desktop"
install -d -m 700 "$state_dir"
printf 'mode=%s\nresolved=%s\n' "$mode" "$resolved" > "$state_dir/theme-state"
