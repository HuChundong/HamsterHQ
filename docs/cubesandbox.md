# Running on CubeSandbox

English | [中文](cubesandbox.zh.md)

The Docker simulation in [README.md](../README.md) needs nothing but Docker and
is what a laptop runs. This is the other runtime: one microVM per tenant, which
is what a deployment serving real people runs and what the model credential's
withholding depends on. It assumes a CubeSandbox installation, a registry it
can pull from, and `cubemastercli` on the host.

## Sandbox version

Every production sandbox build carries a **date-shaped** version, never a git
hash:

- Form: `YYYY-MM-DD`, or `YYYY-MM-DD.N` when the same day ships more than once
  (for example `2026-08-28.2`).
- That one string is shared by four places and they must agree:
  1. Docker build arg `SANDBOX_VERSION` (baked into `/app/sandbox/VERSION` and
     `env.sh` as `SANDBOX_VERSION`)
  2. Image tag `hamsterhq-sandbox:<version>`
  3. Cube template alias `hamsterhq-sandbox-<version>`
  4. Gateway env `CUBE_TEMPLATE_ID=hamsterhq-sandbox-<version>`

Tenants see the short form (`2026-08-28`) under Settings → Sandbox. When their
machine's version differs from the deployment's current `CUBE_TEMPLATE_ID`, the
page says so and Restart builds a new machine from the current template.

```sh
# Production builds that ship the anti-detect Chromium extract it into the
# build context first — the binary is never in git. CI leaves
# sandbox/browser-engine/ as the placeholder and builds Playwright's shell.
# The previous template alias is left alone — a template is a snapshot, and
# the one already serving tenants is the rollback target. Point
# CUBE_TEMPLATE_ID at the new alias only after the new template is READY.
#
# Pick today's date (or .N). Do not use a git short hash as TAG.
SANDBOX_VERSION=2026-08-28   # or 2026-08-28.2 on a same-day rebuild
cid=$(docker create anti-detect-chrome:v3)
rm -rf sandbox/browser-engine && mkdir -p sandbox/browser-engine
docker cp "$cid:/opt/chrome/." sandbox/browser-engine/
docker rm "$cid"
SANDBOX_VERSION=$SANDBOX_VERSION BROWSER_SOURCE=antidetect \
  docker compose -f compose.yml -f compose.cube.yml --profile build build

# The sandbox image reaches CubeSandbox through a registry it can pull from,
# not through the local Docker daemon.
docker tag hamsterhq-sandbox:latest 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION
docker push 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION

# A new template each time, not an update to the old one: a template is a
# snapshot taken when it is created, and pointing an existing one at a new
# image leaves every sandbox restoring the snapshot it already had. Set
# CUBE_TEMPLATE_ID to the alias. Keep the previous alias — rolling back is
# pointing CUBE_TEMPLATE_ID at it again and `up -d`.
#
# Nothing here pre-starts the sandbox's browser: create-from-image takes no
# start or ready command, so the browser launches with each tenant's backend
# instead — backgrounded, so nothing a tenant waits on waits on it.
cubemastercli template create-from-image \
  --image 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION \
  --alias hamsterhq-sandbox-$SANDBOX_VERSION \
  --writable-layer-size 20Gi --cpu 2000 --memory 4000

# Then in .env: CUBE_TEMPLATE_ID=hamsterhq-sandbox-$SANDBOX_VERSION
docker compose -f compose.yml -f compose.cube.yml up -d
```

The overlay names the CubeSandbox API, the CubeProxy node, and a
`GATEWAY_TUNNEL_URL` on a host address — a sandbox is a machine on Cube's
network, so it cannot dial a compose service name.

Three things about this runtime are worth knowing before running it, and
[docs/design.md](design.md) explains why each is the way it is:

- **The template is generic.** It is a snapshot of the image *running*, so the
  image declares no `CMD`; the gateway starts one tenant's backend per sandbox
  through envd once it has an identity to start it with.
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
