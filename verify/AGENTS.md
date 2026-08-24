# AGENTS.md — verify/

English | [中文](AGENTS.zh.md)

The acceptance suite: what can only be decided against a running deployment.
Why it lives outside CI, and the warning about real addresses, are in the
[root file](../AGENTS.md). This page is what a check here has to be built out of.

## How a check is shaped

`verify-<property>.mjs` for anything that speaks the API, `verify-<subject>.sh`
for anything that needs a shell inside a sandbox, and `verify.sh` is the runner
that owns the pass and fail counters.

The opening comment says which property the check proves and why that property
is worth a run of its own — `verify-turn.mjs` states the distinction the whole
suite turns on: everything else proves the plumbing answers, and it proves the
product works.

Every input is an environment variable with a default, so a run needs no
arguments and a deployment with different names needs no edit:

```js
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const USER = process.env.TURN_USER ?? process.env.VERIFY_ALICE ?? 'delivered+alice@resend.dev'
```

Signing in is imported rather than repeated: `signIn` from `verify-login.mjs` is
the one place that knows the sign-in sequence. Timeouts are named constants —
a real model turn is allowed three minutes, and a number spelled inline in a
socket handler is a number nobody can find when a slower deployment starts
failing.

## Both runtimes, behind the sandbox helpers

The suite runs against either sandbox runtime, and the two have nothing in
common to inspect: under `docker` a sandbox is a container on this host, and
under `cube` it is a machine on Cube's network that only the gateway container
has the credentials and the route to reach. So everything about a tenant's
sandbox goes through the `sandbox_*` helpers in `verify.sh` — listing owners,
listing handles, running a script, removing them all. A check that reaches for
`docker` directly works on one runtime and silently skips the other.

The `cube` helper runs inside the gateway container, because that is the only
place with the client, both of Cube's planes, and a route to them. It is copied
in at run time rather than baked into the image: the gateway carries no
verification code.

Scripts reach a sandbox base64-encoded, so that neither `docker exec sh -c` nor
envd's `bash -l -c` has to survive the suite's own quoting.

## What a check may not assume

Four assumptions that were each true once and then were not:

- **That the deployment is empty.** An operator signed in to the console has a
  sandbox too. Anything that acts on "the sandbox" scopes to one tenant —
  taking whichever came back first once wrote a marker into somebody else's
  machine.
- **That an administrator exists.** An invite is minted straight into the table
  so that signing in does not depend on one. It is wrapped in a CTE to keep the
  statement a `SELECT`, because `psql` prints an `INSERT 0 1` command tag on
  stdout beside the returned row, and a caller capturing both gets a code with
  a line of status stuck to it.
- **That the policy version is known.** It is read off the sign-in form rather
  than written down here. Bumping the documents must not break the suite — and
  a form that stopped asking for consent at all then fails here, which is
  exactly the regression nothing else would catch.
- **That a previous run cleaned up.** Unredeemed invites are cleared before
  minting, because every run mints its own.

A verification code comes out of the deployment's database, never out of a
mailbox. That is operator access rather than a way in that a user has: the code
is a secret held for ten minutes, and anyone who can read that database can
already mint a session.
