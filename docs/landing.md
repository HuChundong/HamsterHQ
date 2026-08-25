# The landing page

English | [中文](landing.zh.md)

`http://localhost:8080/` answers a signed-in tenant with the application and
everyone else with [`web/landing/`](../web/landing/), served at that address
rather than redirected to one. It reaches no other host — no CDN, no framework,
no analytics — because a deployment on a private network is a place where an
external request is not slow but unanswered. The three faces it is set in — Host Grotesk, DM Sans, and Fragment Mono —
are in `web/landing/fonts/`, latin subsets, about 71 KB together; they are
[SIL Open Font License](https://openfontlicense.org) and redistributing them
beside this MIT source is what that licence is for.

The same document is served again at `/plans`, without asking who is calling.
`/` cannot be that address: it sends anyone holding a session to `/app`, which
is right for a front door and wrong for the one section of it a signed-in
tenant has a reason to open — what the tiers are, which is what Settings ›
Account links to.

It is built by [Vite](https://vite.dev): `index.html`, `styles.css` and
`main.js`, with every asset emitted under a name carrying its own content hash
and every reference to it rewritten from the parsed document. That is what lets
the assets be cached for a year while the document is not — replace a
screenshot and it is a different URL, so it arrives on the first load instead
of whenever the old one expires. One build definition, three consumers: the
Dockerfile's `landing` stage, the Pages workflow, and the dev server below.

[`gateway/assets/hamster.svg`](../gateway/assets/hamster.svg) is the primary mark:
a transparent, single-colour line drawing built from curvature-continuous
Bézier contours. It draws in ink black on light surfaces and warm white on dark
ones. The square `favicon.svg` uses the same geometry with a stronger small-size
optical weight correction. The filled `web/landing/avatar.webp` is a compact
account-avatar variant based on the same profile, not a rasterisation of the
line mark; keep it as a separate variant.
The anatomy, palette, scene roles, and review sizes are recorded in the
[brand and mascot guide](brand.md).

The same source is the project page on GitHub Pages, published by
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml). Serving from two
roots is why `base` is `./` and why its application links are absolute;
`scripts/check-landing.mjs` asserts that, along with both languages being
present for every string it shows.

```sh
scripts/landing-preview.sh        # the dev server, reloading as you edit
```

The marks on the page are the gateway's, named at their real path
(`../../gateway/assets/…`) rather than copied in beside it, so replacing one
reaches the front door and the sign-in page together.
