#!/bin/bash
# Keep Playwright CLI's upstream implementation, adding only the desktop VM's
# on-demand process boundary before commands that need a browser.
set -eu

real=/usr/local/lib/node_modules/@playwright/cli/playwright-cli.js

case "${1:-}" in
  ''|-h|--help|-V|--version|install|config-print|close|list)
    ;;
  *)
    /usr/local/bin/start-desktop-browser
    ;;
esac

exec node "$real" "$@"
