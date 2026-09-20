# Local Docker acceptance

English | [中文](local-docker.zh.md)

## Model credentials

Docker is the local simulation runtime. Use [the development model proxy](../dev/model-proxy.mjs)
with [its Compose overlay](../dev/model-proxy.compose.yml): only that service
mounts the operator's source environment file, read-only. The gateway and every
sandbox receive a nonsecret placeholder and the internal proxy URL. The proxy
uses the configured upstream, accepts only model API endpoints, rejects redirects,
and does not log request headers or response bodies. It publishes no host port.
The behavior is exercised by scripts/check-dev-proxy.mjs in the tree gates.

Keep the source environment file mode at 0600. Set MODEL_SOURCE_ENV to its absolute
path if it is not the checkout's .env. Do not store a real model credential in the
local deployment environment or its database settings. A database model setting
overrides the environment; use a fresh Compose project and database for acceptance.

## Run and verify

**Use a dedicated Docker daemon or host containing no user sandboxes.** The runtime uses a fixed sandbox-owner label, and gateway startup reaps labeled sandboxes absent from its own database. The acceptance runner only removes its two verification accounts' sandboxes, but that does not isolate gateway startup. A fresh project/database/network alone does not isolate that cleanup. Do not run this suite against the Docker daemon used by your everyday deployment. There is no configurable DSH_LABEL isolation.

Prepare a separate local environment file, such as /tmp/dsh-sidebar.env, from
.env.example. Give it fresh session/database secrets, set SANDBOX_RUNTIME=docker,
use the dev mailbox through EMAIL_API_URL=http://mailbox:8025/emails, and set
RESEND_API_KEY to a development placeholder. Set MODEL_API_KEY to
local-proxy-placeholder and MODEL_BASE_URL to http://model-proxy:8098/v1.
Copy the model ID/API metadata from the source environment, without its credential.
Choose unused ports. setup-local generates a unique COMPOSE_PROJECT_NAME and matching COMPOSE_NETWORK; neither isolates sandbox cleanup. Leave AGENT_PYTHON_PACKAGES unset
to retain the complete sandbox toolchain.

From the repository root. setup-local creates fresh environment and administrator
password files and refuses to overwrite existing ones. It copies only model metadata,
never the model credential, and does not change the source file permissions. LOCAL_PROJECT_NAME optionally sets the generated project name. Skip setup-local only when reusing an existing disposable acceptance deployment:

```sh
node dev/setup-local.mjs .env /tmp/dsh-sidebar.env
export COMPOSE_ENV_FILES=/tmp/dsh-sidebar.env
unset COMPOSE_PROJECT_NAME COMPOSE_NETWORK
export COMPOSE_FILE="$PWD/compose.yml:$PWD/dev/model-proxy.compose.yml"
docker compose --profile dev --profile build build sandbox desktop web gateway admin scheduler
docker compose --profile dev up -d
scripts/check-images.sh
npm --prefix verify ci
(cd verify && npx playwright install chromium)
cd verify
SANDBOX_RUNTIME=docker GATEWAY=http://localhost:18090 ./verify.sh
```

Use the gateway port configured in the local environment. The suite's default
addresses are test sinks; never substitute a person's real address. Its model
turns spend real tokens through the proxy. The suite removes sandboxes belonging to its two verification accounts.
The proxy is development-only and does not change CubeSandbox credential injection.

For full desktop acceptance, set LOCAL_SANDBOX_IMAGE=hamsterhq-desktop:latest in
the local environment, then run docker compose up -d gateway. Remove the two
verification accounts’ existing sandboxes on the isolated daemon first, so the
next request creates desktop containers. If Chromium reports pthread_create
resource errors at the default 512 PID limit, set SANDBOX_PIDS_LIMIT: 1024 in
the local Compose override’s gateway environment and recreate the gateway and
verification sandboxes. This limit counts threads too. From verify, keeping
the Compose exports above, run

```sh
VERIFY_DESKTOP=1 SANDBOX_RUNTIME=docker GATEWAY=http://localhost:18090 ./verify.sh
```

The remote deployment omits upstream's host-native application launcher. Both
its host and client plugins are disabled in the runtime and harvested shell
compositions. Files and terminals remain available through the workspace and
Computer. scripts/check-dockerfile.mjs checks both compositions so the browser
does not request unavailable native application routes.
