# AGENTS.md — admin/

English | [中文](AGENTS.zh.md)

The operator console: its own service, its own credential, writing accounts,
invites, settings and the audit trail — and touching no sandbox. That its TOTP is
the one protocol written out here, and why it is tested against RFC 6238's own
vectors, is in the [root file](../AGENTS.md).

## A door that is not on a public street

It binds to `127.0.0.1:8091` by default, and that is a decision rather than a
default worth changing casually.

An operator is not a tenant: no account row, no email code, and nothing here
borrows a tenant's session. `ADMIN_PASSWORD_HASH` must parse as `scrypt$…` or
the service exits — refusing to start rather than starting with a default, which
is a published password. `hash-password.mjs` is the only supported way to
produce one.

The session is an eight-hour JWT in `hq_admin` with **no refresh**: an operator
signs in again rather than holding a session open indefinitely. The
mid-sign-in challenge cookie is a different audience from the session, so a
half-finished sign-in cannot be presented as a finished one.

An unauthenticated request to anything other than `/sign-in` gets **401 with the
sign-in page**, which is how the console avoids confirming that it is there.

The second factor's secret lives only in the `settings` row `admin.second_factor`
— never in an environment variable. It was one once, and a fresh deployment then
demanded a code from a secret nobody had scanned. Enrolment verifies the first
code before it commits, because enabling it without that locks the operator out
permanently.

Recovery codes are held unread in memory and shown exactly once. A refresh does
not show them again, which is the property, not a bug to fix.

## A section is a file, and the shell is not touched

`console-shell.js` carries its own "Adding one" block, and it is accurate: write
`sections/<name>.js` exporting `label`, `icon`, `strings` and `render`, then name
it in `sections/index.js`. Nothing in the shell changes.

`sections/index.js` documents the shape. The field to think about is `needs` —
the router reads exactly what a section declares before rendering it, so a
section that reaches for data it did not declare renders against `undefined`.

`render(state)` returns `{ html, table? }`: the table is for sentences worded at
render time, since everything static is already in `strings`.

Actions are `POST` and answer **303 back to the section** with a `?done=` notice
code, so a refresh does not resubmit. The fetch-shaped caller sends
`X-Console-Action: fetch` and gets `{ notice }` instead. Notice codes have to
exist in `CONSOLE_NOTICES` — which lives in the gateway's `page-chrome.js` so
that `scripts/check-pages.mjs` can read both sides.

An unknown path answers **404, not 405**, so that a missing font does not read
like a routing bug.

Nothing in `console.js` checks a caller. It is unreachable without `server.js`
having admitted one, and a second check would be a second place for the two to
disagree. Do not add one.

Deleting or suspending an account writes the database first and then tells the
gateway, and a failure to delete is never reported as success.

## What a list section owes a large deployment

`PAGE_SIZE` is 20. A list section queries with `windowFor(page)`, renders through
`onePage(rows)` as a backstop, and emits the control from `pager()`.

`scripts/check-paging.mjs` hands every section twice a page and requires that a
page comes back with its pager attached. A new list section needs a branch in
that check's `overfill()` naming the store it reads; a section that grows a
`<tbody>` without one fails as "not in overfill map", which is the check
refusing to guess rather than passing something it did not exercise.

This is not a style rule. An unbounded table is a page whose height is decided
by the deployment's success: it lays out fine on the machine it was built on,
and the day a tenant list reaches four figures it is a document that takes a
second to render, a scrollbar that measures the table instead of the page, and a
query that read every row to show the twenty somebody was looking at. All three
arrive together, on the deployment least able to absorb them.

`scripts/check-env-defaults.mjs` does not scan this directory, so the empty-string
discipline described in [gateway/AGENTS.md](../gateway/AGENTS.md) is unenforced
here and still required.
