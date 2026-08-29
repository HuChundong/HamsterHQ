# Vendored packages

English | [中文](README.zh.md)

One file, and it is here for one reason: `@cubesandbox/sdk` is not published
to npm. The package exists — version 0.3.0, in `sdk/node/` of the
CubeSandbox repository, with `dist` and a `prepublishOnly` script — but
`npm view @cubesandbox/sdk` answers 404, so there is nothing to depend on by
name. This tree therefore carries a build artifact. When the package is
published under that name, the dependency should switch to the registry.

License and attribution are in [NOTICE](../NOTICE).

## The modifications

The tarball is built from TencentCloud/CubeSandbox revision `82a807ab`
on branch `feat/node-sdk-files-read-format` —
[PR #1571](https://github.com/TencentCloud/CubeSandbox/pull/1571) /
[issue #1570](https://github.com/TencentCloud/CubeSandbox/issues/1570).

That commit is the e2b-compatible `files.read` format surface (`text` /
`bytes` / `blob` / `stream`). Until it lands on upstream `master`, this tree
carries the same bytes so the gateway panel can read binary files unaltered.
Do not add a second local change beside it; open another upstream PR instead.

The base already includes [#1485](https://github.com/TencentCloud/CubeSandbox/pull/1485)
(`Connect-Timeout-Ms` guard), which merged after the v0.7.0 tag.

## Rebuilding it

Check out the CubeSandbox revision recorded in NOTICE, then:

```sh
cd <cubesandbox>/sdk/node && npm install && npm run build
npm pack --pack-destination <this-repo>/vendor
# rename to carry the revision + reason, which also stops npm reusing a cached
# tarball of the same name
```

Then point `gateway/package.json` at the new version.

| package | version | license | built from |
| --- | --- | --- | --- |
| `@cubesandbox/sdk` | 0.3.0 | Apache-2.0 | TencentCloud/CubeSandbox `82a807ab` ([#1571](https://github.com/TencentCloud/CubeSandbox/pull/1571)) |
