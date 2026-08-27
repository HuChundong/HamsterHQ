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

The tarball is built from TencentCloud/CubeSandbox revision `9c4837ec` with
two changes.

The first is from [PR #1485](https://github.com/TencentCloud/CubeSandbox/pull/1485).
It stops `commands.run` sending envd a `Connect-Timeout-Ms` that has already
expired. Without it, every command in every sandbox waits until the HTTP
client gives up on headers.

The second is this tree's. Upstream `files.read` always decodes the response
as UTF-8 and returns a string — there is no bytes path, and asking for
`format: 'bytes'` is ignored. A PNG's 0x89 magic byte arrived here as the
three-byte replacement character, and the panel's image viewer drew a
broken glyph over a file that was fine. The official client cannot do what
is needed; the answer the rule requires is an upstream issue and a
documented limitation, and this is both: the tarball honours `format:
'bytes'` and returns a `Uint8Array`, and [docs/sandbox-pitfalls.md](../docs/sandbox-pitfalls.md)
carries the measurement. Do not add a third change beside these two.

## Rebuilding it

Check out the CubeSandbox revision recorded in NOTICE, then:

```sh
cd <cubesandbox>/sdk/node && npm install && npm run build
npm pack --pack-destination <this-repo>/vendor
# rename to carry the patch it holds, which also stops npm reusing a cached tarball
# of the same name
```

Then point `gateway/package.json` at the new version.

| package | version | license | built from |
| --- | --- | --- | --- |
| `@cubesandbox/sdk` | 0.3.0 | Apache-2.0 | TencentCloud/CubeSandbox `9c4837ec` + [#1485](https://github.com/TencentCloud/CubeSandbox/pull/1485) + `format: 'bytes'` |
