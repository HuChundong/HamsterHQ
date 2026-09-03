#!/bin/sh
# What the acceptance run needs to know about the browser inside a tenant's
# sandbox, as `key=value` lines.
#
# The questions are the ones a tenant's agent asks by existing: is there a
# browser, is it reachable only from this machine, and can the CLI the agent
# was taught reach it. Everything here runs inside the sandbox, because every
# one of those is only true in there.
#
# Fed to the sandbox base64-encoded, so that neither `docker exec sh -c` nor
# envd's `bash -l -c` has to survive the quoting. PATH, WORKSPACE and
# DSH_BUNDLED_SKILL_DIR arrive in the caller's prelude, read off the backend
# process — the shell this runs in has none of them under CubeSandbox, and a
# fragment that asks its own shell reports the image's tools missing while a
# tenant is using them.

# What is NOT checked here, and why the absence is written down: the browser
# no longer refuses private addresses. That fence was Obscura's, inside the
# engine, and it left with the engine — Chromium has no such switch. Under
# CubeSandbox the fence is CubeEgress, outside the sandbox where this script
# cannot see it; under plain Docker nothing enforces it. "The browser in the
# sandbox" in docs/design.md carries the account, so a run of this suite does
# not report a property the deployment no longer has.

# What the agent types, and the file that tells it where the browser is. The
# config is resolved relative to the working directory, so it is the workspace
# copy that matters rather than the image's.
echo "cli=$(command -v playwright-cli > /dev/null 2>&1 && echo yes || echo no)"
echo "config=$(grep -c 9222 "$WORKSPACE/.playwright/cli.config.json" 2>/dev/null || echo 0)"

# The skill, in the catalog dsh reads. A tool an agent is never told about is a
# tool it does not have.
echo "skill=$(test -f "$DSH_BUNDLED_SKILL_DIR/playwright-cli/SKILL.md" && echo yes || echo no)"

# And the whole chain, in one command: the CLI, the config, the engine, and
# whatever egress this deployment gives a sandbox. The page is whatever the run
# was pointed at; its title coming back means every part above did its job.
cd "$WORKSPACE" || exit 0
NO_UPDATE_NOTIFIER=1 playwright-cli open "${BROWSER_URL:-https://www.baidu.com}" > /tmp/browser-open.txt 2>&1
echo "opened=$(grep -c 'Page Title:' /tmp/browser-open.txt)"
echo "title=$(sed -n 's/^- Page Title: //p' /tmp/browser-open.txt | head -1)"

# Desktop Chrome is deliberately lazy because its profile belongs to the
# tenant volume. Ask through the CLI first, then inspect the process it started
# over the protocol the client uses. Probing before open reports the intended
# idle state as a missing browser.
echo "cdp=$(curl -s --max-time 5 http://127.0.0.1:9222/json/version | grep -c '"Browser"')"

# Loopback only. The CDP port drives the browser as the tenant — anything that
# can reach it can read what the tenant reads and post as them — so it must not
# be addressable from outside this machine. `ss` prints the address it bound.
echo "bound=$(ss -ltn 2>/dev/null | awk '$4 ~ /:9222$/ { print $4 }' | head -1)"
NO_UPDATE_NOTIFIER=1 playwright-cli close > /dev/null 2>&1
