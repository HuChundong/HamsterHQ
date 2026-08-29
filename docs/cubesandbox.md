# Running on CubeSandbox

English | [中文](cubesandbox.zh.md)

The Docker simulation in [README.md](../README.md) needs nothing but Docker and
is what a laptop runs. This is the other runtime: one microVM per tenant, which
is what a deployment serving real people runs and what the model credential's
withholding depends on. It assumes a CubeSandbox installation, a registry it
can pull from, and `cubemastercli` on the host.

## Two images, one default

| Image | Cube alias prefix | Size at create | Role |
|---|---|---|---|
| `hamsterhq-desktop` | `hamsterhq-desktop-<version>` | 4 CPU / 8 GiB, writable 8Gi | **Default.** KDE Plasma X11 + TigerVNC + noVNC + headed Chrome |
| `hamsterhq-sandbox` | `hamsterhq-sandbox-<version>` | 2 CPU / 4 GiB, writable 8Gi | Light rollback; headless CDP only |

`CUBE_TEMPLATE_ID` points at the **desktop** alias for every plan. Keep the
light alias built and tagged; rolling back is pointing `CUBE_TEMPLATE_ID` at it
again and `up -d`. Optional: `CUBE_TEMPLATE_ID_LIGHT` in `.env` as a note for
operators — the gateway does not read it.

## Sandbox version

Every production sandbox build carries a **date-shaped** version, never a git
hash:

- Form: `YYYY-MM-DD`, or `YYYY-MM-DD.N` when the same day ships more than once
  (for example `2026-08-28.2`).
- That one string is shared by the places that must agree for the **default**
  (desktop) path:
  1. Docker build arg `SANDBOX_VERSION` (baked into `/app/sandbox/VERSION`)
  2. Image tag `hamsterhq-desktop:<version>`
  3. Cube template alias `hamsterhq-desktop-<version>`
  4. Gateway env `CUBE_TEMPLATE_ID=hamsterhq-desktop-<version>`

Tenants see the short form under Settings → Sandbox. When their machine's
version differs from the deployment's current `CUBE_TEMPLATE_ID`, the page says
so and Restart builds a new machine from the current template.

## What freezes into the desktop template

Cube 0.7 `create-from-image` accepts `--cmd` and `--probe`. The desktop image
uses them to freeze a **tenant-free** stack into the memory snapshot:

- dbus, TigerVNC `:0`, KDE Plasma X11, noVNC on `127.0.0.1:6080`, headed Chrome + CDP
  `:9222`, and a tiny health server on `:6099`
- the health server waits for Xvnc/noVNC, a real Chrome page target,
  `plasmashell`, `kwin_x11`, and the applied Fluent theme, then requires five
  stable seconds before Cube may snapshot; Xvnc is checked by process and X11
  readiness, never a bare connection to `:5900`, because failed RFB handshakes
  trigger TigerVNC's client blacklist
- a fixed 1280 x 720 framebuffer at up to 45 updates/s; the Computer pane keeps
  noVNC at JPEG quality 5 and compression 1 to favour input/frame latency over
  maximum visual fidelity or minimum bandwidth
- noVNC control bar / status chrome hidden (CSS + inline style on `vnc.html`,
  same cut as the weixin-bot blueprint) so the Computer pane is only the desktop
- paired Fluent light/dark Plasma, Kvantum, icon and cursor themes, with Baloo
  and KWin compositing disabled for the streamed desktop
- Default browser is `/usr/local/bin/chrome-launch` (anti-detect `/opt/chrome`
  when `BROWSER_SOURCE=antidetect`, else apt Chromium), wired through mimeapps
- only the official Node 24 runtime; noVNC assets come from a throw-away Debian
  stage so its Debian Node 18 packaging dependency does not enter the image

The image still declares **no** `CMD`. `--cmd /app/sandbox/template-warm.sh`
overrides only the template-build boot. After restore, `entrypoint.sh` starts
dsh / tunnel / reporter (tenant-known) and calls `start-desktop.sh`, which is a
no-op when those ports already answer.

Never freeze: dsh, the gateway tunnel, the reporter, workspace / migrate.

## Build and cutover

```sh
# Production builds that ship the anti-detect Chromium sync the host's latest
# compile into the build context first — the binary is never in git. Point
# CHROME_DIST at the chrome-dist/ tree your Chromium workspace just produced
# (not an old packaging image such as anti-detect-chrome:v3). CI leaves
# sandbox/browser-engine/ as the placeholder and builds Playwright's shell.
# The previous template alias is left alone — a template is a snapshot, and
# the one already serving tenants is the rollback target. Point
# CUBE_TEMPLATE_ID at the new alias only after the new template is READY.
#
# Pick today's date (or .N). Do not use a git short hash as TAG.
SANDBOX_VERSION=2026-08-29   # or 2026-08-29.2 on a same-day rebuild
CHROME_DIST=${CHROME_DIST:?set to your workspace chrome-dist/}
test -x "$CHROME_DIST/chrome"
mkdir -p sandbox/browser-engine
rsync -a --delete --exclude README "$CHROME_DIST"/ sandbox/browser-engine/
SANDBOX_VERSION=$SANDBOX_VERSION BROWSER_SOURCE=antidetect \
  docker compose -f compose.yml -f compose.cube.yml --profile build build sandbox desktop

# Registry the Cube nodes can pull from.
docker tag hamsterhq-desktop:latest 127.0.0.1:5000/hamsterhq-desktop:$SANDBOX_VERSION
docker tag hamsterhq-sandbox:latest 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION
docker push 127.0.0.1:5000/hamsterhq-desktop:$SANDBOX_VERSION
docker push 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION

# Desktop template: freeze the warm stack, then snapshot.
cubemastercli template create-from-image \
  --image 127.0.0.1:5000/hamsterhq-desktop:$SANDBOX_VERSION \
  --alias hamsterhq-desktop-$SANDBOX_VERSION \
  --writable-layer-size 8Gi --cpu 4000 --memory 8000 \
  --cmd /app/sandbox/template-warm.sh \
  --expose-port 6099 --probe 6099 --probe-path /health

# Light template (rollback only; no warm freeze).
cubemastercli template create-from-image \
  --image 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION \
  --alias hamsterhq-sandbox-$SANDBOX_VERSION \
  --writable-layer-size 8Gi --cpu 2000 --memory 4000

# Then in .env:
#   CUBE_TEMPLATE_ID=hamsterhq-desktop-$SANDBOX_VERSION
#   CUBE_TEMPLATE_ID_LIGHT=hamsterhq-sandbox-$SANDBOX_VERSION   # operator note
docker compose -f compose.yml -f compose.cube.yml up -d
```

A new template each time, not an update to the old one. Keep the previous
desktop alias — rolling back is pointing `CUBE_TEMPLATE_ID` at it (or at the
light alias) and `up -d`, then releasing active sandboxes so tenants land on
the new template.

The overlay names the CubeSandbox API, the CubeProxy node, and a
`GATEWAY_TUNNEL_URL` on a host address — a sandbox is a machine on Cube's
network, so it cannot dial a compose service name.

Three things about this runtime are worth knowing before running it, and
[docs/design.md](design.md) explains why each is the way it is:

- **The template is generic for tenant state.** Image `CMD` stays empty; the
  gateway starts each tenant's backend through envd. Desktop graphics may be
  frozen via `--cmd`/`--probe` because they need no tenant identity.
- **The model credential never enters a sandbox.** The sandbox holds a
  placeholder and CubeEgress substitutes the real key as the request leaves.
  CubeEgress terminates TLS to do it, so the installation's own root CA has to
  be trusted inside the image — it is never committed, because every
  installation generates its own:

  ```sh
  docker cp cube-egress:/etc/cube/ca/cube-root-ca.crt sandbox/egress-ca/
  ```

- **The gateway has to be allowed back in.** CubeSandbox denies the private
  ranges alongside public egress, so a sandbox cannot reach the infrastructure
  running it. The gateway sits on one of those ranges and is added to
  `allowOut` at creation — see [`gateway/src/egress.js`](../gateway/src/egress.js).
