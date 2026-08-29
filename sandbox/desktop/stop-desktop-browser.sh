#!/bin/bash
# Ask Chrome to flush its persistent profile before the VM is reclaimed.
set -eu

if ! curl -fsS --max-time 1 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  exit 0
fi

node --input-type=module -e '
  const version = await fetch("http://127.0.0.1:9222/json/version", {
    signal: AbortSignal.timeout(1000),
  }).then((response) => response.json())
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000)
    const done = () => { clearTimeout(timer); resolve() }
    socket.onclose = done
    socket.onerror = done
    socket.onmessage = (event) => {
      try {
        if (JSON.parse(event.data).id === 1) done()
      } catch {}
    }
    socket.send(JSON.stringify({ id: 1, method: "Browser.close" }))
  })
' || true

cdp_closed=false
for _ in $(seq 1 20); do
  if ! curl -fsS --max-time 1 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
    cdp_closed=true
    break
  fi
  sleep 0.25
done

if [ "$cdp_closed" != true ]; then
  echo "stop-desktop-browser: Chrome did not close CDP" >&2
  exit 1
fi

# Browser.close drops CDP before Chrome's profile-owning process has finished
# committing its SQLite stores. Wait for every non-zombie Chrome process; PID 1
# may leave reaped children visible in a container, but zombies hold no files.
chrome_running() {
  ps -u desktop -o stat=,comm= \
    | awk '$2 == "chrome" && $1 !~ /^Z/ { found=1 } END { exit found ? 0 : 1 }'
}
for _ in $(seq 1 40); do
  chrome_running || break
  sleep 0.25
done
if chrome_running; then
  echo "stop-desktop-browser: Chrome did not finish profile shutdown" >&2
  exit 1
fi

# JuiceFS may still hold completed writes in its client cache after Chrome has
# exited. Bounded sync makes the volume hand-off durable without making a
# stalled storage backend prevent sandbox reclamation forever.
profile="${CHROME_PROFILE_DIR:-/mnt/browser-profile}"
timeout 5 sync -f "$profile" 2>/dev/null || true
