#!/bin/sh
# What the acceptance run needs to know about the browser inside a tenant's
# sandbox, as `key=value` lines.
#
# The questions are the ones a tenant's agent asks by existing: is there a
# browser, can the CLI it was taught reach it, and is that browser fenced the
# way this deployment says it is. Everything here runs inside the sandbox,
# because every one of those is only true in there.
#
# Fed to the sandbox base64-encoded, so that neither `docker exec sh -c` nor
# envd's `bash -l -c` has to survive the quoting.

# The engine, asked over the protocol its client will use rather than by
# looking for a process: a browser that is running and not listening is the
# same to an agent as no browser at all.
echo "cdp=$(curl -s --max-time 5 http://127.0.0.1:9222/json/version | grep -c '"Browser"')"

# Loopback only. The CDP port drives the browser as the tenant — anything that
# can reach it can read what the tenant reads and post as them — so it must not
# be addressable from outside this machine. `ss` prints the address it bound.
echo "bound=$(ss -ltn 2>/dev/null | awk '$4 ~ /:9222$/ { print $4 }' | head -1)"

# The fence that makes a browser in a sandbox something other than a way into
# the deployment. An agent can be talked into fetching an internal address, and
# the request would leave from in here rather than from whoever asked. Obscura
# refuses private and loopback ranges unless told otherwise; this asks it to
# fetch one and reports whether it declined.
if obscura fetch http://127.0.0.1:9222/json/version --dump text > /dev/null 2>&1; then
  echo "private=allowed"
else
  echo "private=refused"
fi

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
NO_UPDATE_NOTIFIER=1 playwright-cli close > /dev/null 2>&1
