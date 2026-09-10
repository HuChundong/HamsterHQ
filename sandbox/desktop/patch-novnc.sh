#!/bin/sh
# Dress Debian's noVNC vnc.html for this deployment. Run once at image build,
# from the desktop-system stage, after the noVNC assets are in place.
#
# noVNC is a dependency and stays one; this edits the one HTML page it ships
# as a demo, which is what vnc.html is — "noVNC example: simple example using
# default UI", its own header says. What changes is the page's dress and not
# its behaviour: whose icon and name the tab carries, what covers the canvas
# while the connection comes up, and which of noVNC's controls are drawn.
# Everything of substance lives in the two files installed beside it, so this
# script is only the seams. Each edit is asserted at the end, because sed
# matches nothing without complaint and a noVNC upgrade that moves a line
# would otherwise ship a page half-dressed.
#
# Usage: patch-novnc.sh <assets-dir> [novnc-root]
set -eu

assets=$1
novnc=${2:-/usr/share/novnc}
page="$novnc/vnc.html"

install -m 0644 "$assets/novnc-hamsterhq.css" "$novnc/app/styles/hamsterhq.css"
install -m 0644 "$assets/novnc-hamsterhq.js" "$novnc/app/hamsterhq.js"
install -m 0644 "$assets/hamsterhq-favicon.svg" "$novnc/app/images/hamsterhq-favicon.svg"

# The tab. noVNC links its own icon at thirteen raster sizes plus four Apple
# touch icons; every one of those lines names the same directory, so one
# pattern removes them all. What replaces them is this deployment's mark, as
# the one SVG the gateway's pages also use, and a title dsh-computer overrides
# from the URL in the person's language — "Computer" is the fallback for a
# URL typed by hand.
sed -i '/href="app\/images\/icons\/novnc-/d' "$page"
sed -i 's|<title>noVNC</title>|<title>Computer</title>\n    <link rel="icon" type="image/svg+xml" href="app/images/hamsterhq-favicon.svg">|' "$page"

# The dress: one stylesheet after noVNC's own so it wins on order, and one
# classic script so the ground, ink and name are set before the body parses.
sed -i 's|<link rel="stylesheet" href="app/styles/base.css">|&\n    <link rel="stylesheet" href="app/styles/hamsterhq.css">\n    <script src="app/hamsterhq.js"></script>|' "$page"

# The wait. First thing in the body so it is on screen the moment the HTML
# arrives, before a single module has been fetched; hamsterhq.css hides it
# once the root carries noVNC_connected.
sed -i 's|<body>|<body>\n    <div id="hhq-loading" role="status"><span class="hhq-spinner" aria-hidden="true"></span><span id="hhq-loading-label">Connecting to the computer…</span></div>|' "$page"

# The control bar, hidden inline as well as by stylesheet so it never paints
# before the stylesheet arrives.
sed -i \
  -e 's/id="noVNC_control_bar_anchor" class="noVNC_vcenter"/id="noVNC_control_bar_anchor" class="noVNC_vcenter" style="display: none;"/' \
  -e 's/<div id="noVNC_control_bar">/<div id="noVNC_control_bar" style="display: none;">/' \
  "$page"

fail() { echo "patch-novnc: $1" >&2; exit 1; }
grep -q 'app/styles/hamsterhq.css' "$page" || fail 'stylesheet link not inserted'
grep -q 'app/hamsterhq.js' "$page" || fail 'bootstrap script not inserted'
grep -q 'hamsterhq-favicon.svg' "$page" || fail 'favicon not linked'
grep -q '<title>Computer</title>' "$page" || fail 'title not replaced'
grep -q 'id="hhq-loading"' "$page" || fail 'loading overlay not inserted'
grep -q 'id="noVNC_control_bar" style="display: none;"' "$page" || fail 'control bar not hidden'
if grep -q 'images/icons/novnc-' "$page"; then fail 'a noVNC icon link survived'; fi
echo 'patch-novnc: vnc.html dressed'
