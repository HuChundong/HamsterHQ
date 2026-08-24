# AGENTS.md — scripts/

English | [中文](AGENTS.zh.md)

Gates that can be decided from the tree or the built images. Which checks belong
here rather than in `verify/` is in the [root file](../AGENTS.md); this page is
how one is written once it belongs here.

## A check is one file, and the list names it

`check-<subject>.mjs`, run by `node` with no arguments, doing one thing that can
be named in its filename. It is added to the loop in `check.sh`, which spells
every filename out rather than globbing the directory — so grepping for a
check's name finds both the file and the place it runs, and a file dropped in
here without being added to the list runs nowhere.

Order in that list is deliberate: it fails fastest on the most common mistake.
A new check goes where its failure would be most useful, not at the end.

`check-images.sh` is the exception that proves the boundary. It is shell because
it runs `docker` against built images, and it is not in `check.sh` for the same
reason — CI runs it in the job that builds them. Shell files are held to
shellcheck in CI, found by extension or by shebang, so a new one passes
`shellcheck` before it is pushed.

## What a check says, passing and failing

On success, one line naming the property that now holds — not that the check
ran:

```
check-assets: hashed names are immutable, fixed names revalidate
check-plugin-load: every plugin imports without throwing
```

`check: ok` would be a line that survives the property it was meant to
describe. The passing line is also where a reader learns what the check is for,
because it is the only part of the file most people will ever see.

On failure, `console.error` and `process.exit(1)`. Say what the failure means
before listing what failed, because the list on its own reads as noise to
whoever did not write the check:

```
check-totp: an authenticator app cannot report this — it just fails to let anybody in
check-service-env: this does not fail at runtime — it reports a default as the deployment's answer
```

Collect every problem and report them together rather than throwing on the
first. A check that stops at the first mistake turns one run into as many runs
as there are mistakes.

## How a check reads what it checks

Import the real thing and run it; do not re-describe it. A check that carries
its own copy of what the code should produce is a second implementation, and it
will agree with itself while both drift:

```js
const { SECTIONS } = await import('../admin/sections/index.js')
const { PAGE_SIZE } = await import('../admin/sections/paging.js')
```

Top-level `await import()` rather than a static import, because these modules
are read for their exports at the moment the check needs them, and a check
whose subject fails to load should fail as that check rather than as a module
error at startup.

Derive nothing that the tree already derives. `check.sh` builds the artifact
panel's browser half before the loop, because `check-plugin-load` reads the
derived file — a check that reads a build output is a check that must be ordered
after the build, not one that runs the build itself.

The opening comment carries the reason, in the same voice as the rest of the
repository: what has to hold, and what went wrong when it did not. The comments
in `check-paging.mjs` and `check-docs.mjs` are the two worth reading before
writing a new one.
