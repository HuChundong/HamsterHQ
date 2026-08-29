# 内置依赖

[English](README.md) | 中文

只有一个文件，原因也只有一个：`@cubesandbox/sdk` **没有发布到 npm**。这个包是存在的
——0.3.0 版，在 CubeSandbox 仓库的 `sdk/node/` 下，有 `dist`，也有
`prepublishOnly` 脚本——但 `npm view @cubesandbox/sdk` 返回 404，按名字依赖不到它。
因此本仓库以构建产物携带。上游按该名正式发包之后，应改回按名依赖。

许可与署名见 [NOTICE](../NOTICE)。

## 这份构建带的修改

这份 tarball 构建自 TencentCloud/CubeSandbox 修订 `82a807ab`，分支
`feat/node-sdk-files-read-format`——
[PR #1571](https://github.com/TencentCloud/CubeSandbox/pull/1571) /
[issue #1570](https://github.com/TencentCloud/CubeSandbox/issues/1570)。

该提交是与 e2b 对齐的 `files.read` format 表面（`text` / `bytes` / `blob` /
`stream`）。在合入上游 `master` 之前，本仓库携带同一份产物，以便网关面板能按
原样读二进制文件。不要在旁边再加第二处本地改动；应另开上游 PR。

基线已包含 [#1485](https://github.com/TencentCloud/CubeSandbox/pull/1485)
（`Connect-Timeout-Ms` 守卫），它在 v0.7.0 标签之后合入。

## 怎么重新构建

按 NOTICE 记录的修订检出 CubeSandbox，然后：

```sh
cd <cubesandbox>/sdk/node && npm install && npm run build
npm pack --pack-destination <this-repo>/vendor
# rename to carry the revision + reason, which also stops npm reusing a cached
# tarball of the same name
```

然后把 `gateway/package.json` 指到新版本。

| 包 | 版本 | 许可 | 构建自 |
| --- | --- | --- | --- |
| `@cubesandbox/sdk` | 0.3.0 | Apache-2.0 | TencentCloud/CubeSandbox `82a807ab`（[#1571](https://github.com/TencentCloud/CubeSandbox/pull/1571)） |
