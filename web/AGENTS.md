# AGENTS.md — web/

English | [中文](AGENTS.zh.md)

nginx, the harvested shell, and the front door. `patch-loopback.mjs` is the one
sanctioned harness patch and the [root file](../AGENTS.md) carries the argument
for it; what is here is how the rest of this directory is put together.

## Three layers of nginx, and the header that is not inherited

`nginx.conf` holds the listeners and everything global. `site.inc` holds every
business `location` and is included by both the HTTP and the HTTPS server, so a
route written once is served on both. `entrypoint.sh` writes two more includes at
container start — the redirect, and the admin virtual host when `ADMIN_DOMAIN` is
set — which is why a route added for the console goes in that script rather than
in `site.inc`.

Two things a proxied location must do:

- **`proxy_pass http://$gateway_upstream`**, through the variable. A literal
  `upstream` block resolves the name once at startup, so a gateway that moves
  gives 502s until the web container is restarted by hand.
- **Set `X-Forwarded-For` itself.** `proxy_set_header` does not inherit: a
  location that sets any header at all loses the ones set above it. The sign-in
  limit once counted per forged header because of exactly this, which is why
  `scripts/check-forwarded.mjs` reads both this file and `entrypoint.sh` and
  fails on a proxied location without it. Sign-in also needs
  `X-Forwarded-Proto`; sockets and event streams need `Upgrade` and
  `Connection`.

## The front door is a separate document

The landing page is a Vite project in `landing/`, built to `dist/` and served
from its own root — deliberately not from the shell's, because the shell is
upstream's published output and a name that collides is one release away from
being overwritten.

Three Vite settings are load-bearing rather than taste: `base: './'` so the same
HTML serves from a project page and from `/`, `assetsDir: 'landing'` so nothing
lands in `/assets/` beside the shell's own hashed files, and
`assetsInlineLimit: 0` so images stay files — inlined into a `no-cache` document
they would be re-downloaded on every load.

`scripts/check-landing.mjs` is mostly a set of cross-file assertions, which is
what makes it worth reading before editing anything here. It holds the landing
page's Vite output against the paths in `site.inc` and the steps in the
`Dockerfile`; it holds the `dsh-lang` and `dsh-theme` storage keys against
`gateway/src/page-chrome.js`, because a language chosen on the front door has to
survive the trip to the sign-in page; it requires every raster image under
`landing/` and `docs/assets/` to be webp; and it counts brand-mark references so
that a copy of a gateway asset cannot appear here. `scripts/landing-preview.sh`
runs the dev server.

## Names that carry a hash, and names that do not

A name containing its content's hash may be cached forever and is served
`immutable`. A name that does not must be revalidated, and `no-cache` is the only
correct answer for it — never `expires`, never a non-zero `max-age`.
`scripts/check-assets.mjs` enforces both directions across nginx and the
gateway's pages. What it is preventing is not a slow page: it is a deployment
where a changed mark or screenshot reaches some visitors and not others, and
which one a visitor got depended on which page they opened first.

`patch-loopback.mjs` runs in the `shell` stage after `harvest-shell.mjs` and
fails the image build in three ways, all deliberate: the target file is gone,
the shell is already patched — which means the script ran twice and the second
run had nothing to do — or the expression it matches is not there exactly once,
which is what a DSH upgrade that reshaped the decision looks like. In that last
case the error tells the next reader to update the expression or, better, to
delete the script if the release made the decision configurable.

Because a build can be green and a tag can be moved by hand,
`scripts/check-images.sh` greps the bundle nginx will actually serve for the
patched value. That is the assertion that catches a patch lost to a cached layer.
