# Contributing

English | [中文](CONTRIBUTING.zh.md)

How a change gets from a working copy into `main`. What a change has to be
true about is [AGENTS.md](AGENTS.md); this page is only the route.

## main only moves through a pull request

Nothing is pushed to `main` — not a one-line fix, not a documentation typo, and
not by whoever owns the repository. Every change arrives as a pull request whose
checks passed, squashed on merge.

This is enforced twice, and the two layers are not redundant. The server holds a
ruleset with an empty bypass list, so the push is refused for everyone:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - 2 of 2 required status checks are expected.
 ! [remote rejected] HEAD -> main (push declined due to repository rule violations)
```

That refusal arrives after the objects have been counted, compressed and sent,
and it names a rule rather than a way forward — which is what
`.githooks/pre-push` is for. It costs no round trip and it says what to do
instead. Enable it, along with the pre-commit gates, once per clone:

```sh
git config core.hooksPath .githooks
```

The hook is a convenience and the ruleset is the rule. Pushing past the hook
with `--no-verify` does not work; it only fails later and less clearly.

## Branches are named for what they carry

`<type>/<subject>`, where the type is one of `feat`, `fix`, `docs`, `chore`, or
`ci`, and the subject is a few words with hyphens between them:

```
feat/artifact-panel-terminal
fix/upload-channel-content-length
docs/sandbox-pitfalls-mount-lies
chore/dev-standards-and-pr-workflow
```

The type is a convention rather than a gate — nothing rejects a branch for
being called something else, because a branch name lives for a day and is
deleted on merge. It is worth getting right anyway: it is what the pull request
list is read by.

## The pull request is the commit message

Merges are squashed, and the squash takes its subject from the pull request's
title and its body from the pull request's description. So the title and
description are not a note to a reviewer that disappears afterwards — they are
the commit message `main` carries forever, and `git log` on `main` shows exactly
what was written in the pull request form.

Write them the way the rest of the history reads: a subject line in the
imperative that says what the change does, then a body that says why it was
needed and what would go wrong without it.

```
Refuse a push to main where the reason is still local

The server refuses it too, with a ruleset that has no bypass list, so this
is not what makes main pull-request-only. It is what makes the refusal
legible: a rejected push comes back as a protocol error after the objects
have been sent and names a rule rather than a way forward.
```

**Wrap the description at 72 columns.** GitHub wraps anything wider when it
builds the squash message, and it wraps each line on its own rather than
reflowing the paragraph — so a 78-column line becomes a 69-column line with one
orphaned word beneath it. The commit that added this page is the evidence: its
description carried 36 lines over 72 columns, and every one of them is two lines
in `main` now. Nothing checks this, because the tree cannot see a pull request's
description.

GitHub also appends the co-authors of the commits it squashed, under a rule of
dashes. That trailer is not something you wrote and not something to remove.

This history does not use Conventional Commits. `fix(web): …` is how the
upstream harness writes its commits and it is a reasonable convention; it is
not this one, and a history with two conventions in it reads as neither.

Commits on the branch itself are working notes and are squashed away, so they
can be as untidy as the work was. Nothing checks their format.

## A stack, when the second change needs the first

Sometimes a change is honestly two changes and the second cannot be reviewed
without the first. Then the second pull request's base is the first's branch
rather than `main`, and the pair is a stack.

**A chain of base branches is not a stack until GitHub says it is.** The order
lives in GitHub's own stack object, which is what applies the branch rules and
the checks to every layer and what merges them bottom-up. It is reached through
the official CLI extension:

```sh
gh extension install github/gh-stack
gh stack link            # make an existing chain official, bottom to top
gh stack view
```

Land the whole thing at once, squashed, so `main` gets one commit per layer in
order:

```sh
gh stack merge --yes --squash
```

Nothing about a stack loosens the rules. `gh stack` does not bypass required
checks or the pull-request rule — bypassing merge requirements is unsupported
for stacked merges specifically — so every layer is held to what a standalone
pull request is held to.

Three rules that are about the work rather than the tooling, and the first is
the one that gets it wrong:

- **A fix belongs on the layer that introduced the problem**, and then flows
  upward into its children. Fixing it on the top layer instead leaves the lower
  pull request shipping the unfixed code and hides the fix from the person
  reviewing it.
- **Keep the layers current by rebasing the stack**, with `gh stack rebase` and
  then `gh stack push`, or `gh stack sync`. A rewritten push must be
  lease-protected and must abort rather than overwrite a remote that moved;
  raw `--force` is forbidden.
- **A rewritten push invalidates its own evidence.** Rebasing changes commit
  identities, so review threads anchored to the old ones no longer prove that a
  finding is resolved. Re-read the unresolved threads, and the checks, after
  every rewrite.

Work each layer in its own worktree. Parallel fixes that share one checkout
land in the wrong layer, which is the first rule above broken by accident.

Because merges here are squashed, a layer's own commits are working notes like
any other branch's — what lands in `main` is each pull request's title and
description, one per layer.

## What to run before you open it

The tree-side gates, which the pre-commit hook already runs for you:

```sh
npm run check
```

That is the same list CI starts with, so a pull request that fails it fails
`everything the tree decides` in about eight seconds. It needs no network, no
container and no deployment.

What the tree cannot decide needs more, and the split is the one in
[AGENTS.md](AGENTS.md). After a build, what actually resolves and loads inside
the images:

```sh
scripts/check-images.sh
```

And a change to behaviour needs the acceptance suite against a real deployment,
which CI cannot run — a green CI is not evidence that a behaviour change works:

```sh
cd verify && SANDBOX_RUNTIME=cube COMPOSE_FILE=../compose.yml:../compose.cube.yml \
  GATEWAY=https://host:8443 ./verify.sh
```

It spends real model tokens and removes every sandbox, and it signs in as the
addresses it is given, so never point it at a person's real address.

## What the review is looking for

Four questions, in the order they usually go wrong. Each is a rule with a home
in [AGENTS.md](AGENTS.md), and most of them are held by a check that names
itself when it fails.

- **Is the harness still a dependency?** Nothing patches, vendors or forks it,
  with the one documented exception.
- **Which plugin does this belong in?** Take the gateway away — is this still
  needed? A change that fits none of the five plugins means the question has a
  new answer, not that one of them should grow a second subject.
- **Does the rule this change relies on have exactly one home?** A fact
  restated in two files is a fact that will disagree with itself. Rationale
  goes in [docs/design.md](docs/design.md), a failure that cost debugging time
  in [docs/sandbox-pitfalls.md](docs/sandbox-pitfalls.md), a directory's local
  conventions in that directory's `AGENTS.md`.
- **If this is a new invariant, what fails when it breaks?** A rule nothing
  enforces is a rule that drifts. Add the check to `scripts/` and to the one
  list in `scripts/check.sh`, and name it in the prose that states the rule.

Documentation is checked mechanically and it is easy to forget: every English
page has a Chinese pair, each names the other, and the two carry the same `##`
sections. `scripts/check-docs.mjs` says so in under a second.
