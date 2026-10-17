# AGENTS.md — web/

English | [中文](AGENTS.zh.md)

nginx, the harvested shell, and the front door. Nothing here patches the
harness — the [root file](../AGENTS.md) carries what used to be the one
exception and why it is gone; what is here is how the rest of this directory is
put together.

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

The `shell` stage harvests and does nothing else, so what it saves is upstream's
bytes. That is worth asserting, because the failure it would hide is a setting
that silently stops sticking: through 0.2.0 the client picked `memory`
persistence from the page hostname, and a patch in this stage replaced that
choice. 0.2.1-alpha.3 removed the decision upstream, which is why the stage is
now bare.

`scripts/check-images.sh` reads the settings bundle nginx will actually serve and
fails if the locality gate is back. A build can be green and a tag can be moved
by hand, so this is asserted against the served bytes rather than against the
build having run.

The shell now carries query-addressed combo scripts. `harvest-shell.mjs` saves
both module entries and batches, while `shell-assets.mjs` maps each complete URL
to a distinct file. nginx uses the generated exact request-URI map; dropping the
query would collapse all bundles into one. `check-shell-assets.mjs` checks that
mapping.

Lazy client chunks are absent from that graph. The harvester follows published
package-local `require.async('./client.*.js')` imports recursively, using the
owning entry's revision even when the import is inside another chunk. Scanning
a combined batch loses that ownership. `check-shell-assets.mjs` checks owner
and revision resolution; `check-images.sh` checks the discovered files and the
official terminal and PDF chunks in nginx's document root.
