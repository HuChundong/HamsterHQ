# AGENTS.md — gateway/

English | [中文](AGENTS.zh.md)

The session plane behind nginx: a browser never reaches it directly. That it
carries no harness code, and that prose inside a rendered template may not hold
a backtick, are in the [root file](../AGENTS.md).

## Where a route goes, and what it must ask

There is no framework. `handleRequest` in `src/server.js` is one ordered chain
of `if`s, and order is the routing table — a specific path goes before the
`/api` catch-all, not after it.

Read a body only through `readBody(req, limit)`. It caps and then destroys the
request rather than truncating, so a caller gets `undefined` and never a
half-parsed object.

**Never call `authenticate` from a route. Call `callerOf(req, res)`.** It
authenticates and, when the tokens were renewed, sets the cookies on the
response. A route that authenticates directly gets the right answer and drops
the renewal, which logs the browser out on its next request — the failure
arrives one request later than the mistake, on a page that looks fine.

The `renewedAsHeaders` form exists for nginx's `auth_request`, which discards a
subrequest's own `Set-Cookie`. The one variable that can carry a header back,
`$upstream_http_set_cookie`, keeps only the first of several with the same name,
which is why two renewed cookies leave as two differently named headers.

`/_internal/account` answers **404, not 403**, to a wrong or missing secret, and
refuses every call when `INTERNAL_SHARED_SECRET` is unset. It is hiding rather
than announcing: a 403 tells whoever guessed that the endpoint is real.

Client addresses come from `callerAddress` in `src/send-limit.js`, which reads
the **last** hop of `X-Forwarded-For`. That is only true because nginx overwrites
the header on every proxied location, which `scripts/check-forwarded.mjs`
asserts against `web/site.inc` and `web/entrypoint.sh` — the sign-in rate limit
once counted per forged header, which is a limit that did not exist.

## What a page is made of, and what reads it

A page is a module exporting one function that returns the document, with its
stylesheet as a module-level constant beside it. Everything shared comes from
`src/page-chrome.js` — `documentHead`, the palettes, the field and ground CSS,
the wordmark, the theme and language toggles, the toast codes — and it is
imported rather than copied, including by `admin/`.

Two rules the markup itself carries:

- **Chinese is the markup, English is the table.** Text lives in the document in
  Chinese with a `data-t` attribute naming its key, and `langToggle(table)`
  injects the pair as JSON. A string added without its key does not error and
  does not log: it stays Chinese in an English interface.
- **Asset URLs come from `asset()`**, never written out. `src/page-assets.js`
  hashes the contents of `assets/` at boot and throws there if a file is
  missing, so a missing asset stops the process instead of 404ing later. A
  hand-written path is served by nothing.

Adding a page means adding it to `scripts/check-pages.mjs` in every UI state it
has, because that check renders pages rather than reading them — state is what
holds the untranslated string. If it names an icon or an asset, the file lists
in `scripts/check-icons.mjs` and `scripts/check-assets.mjs` need it too; neither
walks the directory, so an unlisted page is an unchecked page.

## Configuration, and the promises made from it

**`firstOf()`, not `??`.** `??` asks whether a variable exists; compose hands
every optional variable over as an empty string, so it exists and the fallback
never runs. A URL then becomes `fetch('')` in production.
`scripts/check-env-defaults.mjs` reads every `${VAR:-}` out of `compose.yml` and
rejects a non-empty `??` fallback for it — but it scans `gateway/src/*.js` and
nothing else, so the same discipline in `admin/` is on you.

A variable both services read has to be declared in **both** compose blocks.
`scripts/check-service-env.mjs` follows the import chains of both and fails when
the gateway is given one and the console is not — otherwise the console reports
a default as the deployment's answer, which is worse than reporting nothing.

`SESSION_SECRET` under sixteen characters and a missing `RESEND_API_KEY` both
exit at boot rather than starting degraded.

Every field in `src/entitlements.js` must be read somewhere else in
`gateway/src`, and `scripts/check-entitlements.mjs` fails when one is not: a
number added to a tier that nothing enforces is a promise with no mechanism
behind it.

Schema lives in one string in `src/db.js`, re-run at every boot with
`CREATE TABLE IF NOT EXISTS`. There is no migration history — a column that
changed during development changed in its `CREATE TABLE` — so that string is a
licence to create, not to reshape a database that already exists. A column added
to it appears on empty deployments and nowhere else.
