#!/bin/sh
# Every gate that can be decided from this tree alone.
#
# One list, run from two places: the pre-commit hook and CI. They used to carry
# a list each, which drifted the way two lists do — seven of these ran only in
# the hook, and the hook is opt-in, so a pull request could arrive having been
# held to half of them.
#
# Nothing here needs a network, a container or a deployment. What does needs
# `verify/` instead, and the split is the rule in AGENTS.md: decided from the
# tree, or decided against something running.
#
# Usage: scripts/check.sh
set -eu

root=$(git rev-parse --show-toplevel)
cd "$root"

# The panel's browser half is derived, and `check-plugin-load` reads the
# derived file. Building first means the checks see what was just written
# rather than what was written last time.
npm --prefix packages/dsh-artifact-panel run build --silent >/dev/null

npx --no-install oxlint

# In the order that fails fastest on the most common mistake: a plugin that
# does not load, then a page that does not say both languages, then the
# quieter invariants.
#
# Written out rather than assembled from a list of stems, so that grepping for
# a check's filename finds the place it runs.
for check in \
  scripts/check-plugin-load.mjs \
  scripts/check-plugins.mjs \
  scripts/check-pages.mjs \
  scripts/check-landing.mjs \
  scripts/check-assets.mjs \
  scripts/check-shell-assets.mjs \
  scripts/check-dockerfile.mjs \
  scripts/check-icons.mjs \
  scripts/check-docs.mjs \
  scripts/check-forwarded.mjs \
  scripts/check-tunnel-path.mjs \
  scripts/check-env-defaults.mjs \
  scripts/check-entitlements.mjs \
  scripts/check-scheduler-boundary.mjs \
  scripts/check-rules.mjs \
  scripts/check-totp.mjs \
  scripts/check-service-env.mjs \
  scripts/check-paging.mjs \
  scripts/check-computer-action.mjs \
  scripts/check-computer-layout.mjs \
  scripts/check-panel-paths.mjs \
  scripts/check-panel-open.mjs \
  scripts/check-uploads.mjs
do
  node "$check" >/dev/null
done

echo "check: parses, loads, and says both languages"
