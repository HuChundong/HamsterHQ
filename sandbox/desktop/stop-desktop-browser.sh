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

for _ in $(seq 1 20); do
  if ! curl -fsS --max-time 1 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.25
done

echo "stop-desktop-browser: Chrome did not stop cleanly" >&2
exit 1
