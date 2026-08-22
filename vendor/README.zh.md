# 内置依赖

[English](README.md) | 中文

只有一个文件，原因也只有一个：`@cubesandbox/sdk` **没有发布到 npm**。这个包是存在的
——0.3.0 版，在 CubeSandbox 仓库的 `sdk/node/` 下，有 `dist`，也有
`prepublishOnly` 脚本——但 `npm view @cubesandbox/sdk` 返回 404，按名字依赖不到它。
因此本仓库以构建产物携带。上游按该名正式发包之后，应改回按名依赖。

许可与署名见 [NOTICE](../NOTICE)。

## 这份构建带的修改

这份 tarball 构建自 TencentCloud/CubeSandbox 修订 `9c4837ec`，并带上
[PR #1485](https://github.com/TencentCloud/CubeSandbox/pull/1485) 的改动。该改动
阻止 `commands.run` 向 envd 发送一个已经过期的 `Connect-Timeout-Ms`。没有它，每个
沙箱里的每条命令都会等到 HTTP 客户端放弃等待响应头。

## 怎么重新构建

按 NOTICE 记录的修订检出 CubeSandbox，然后：

```sh
cd <cubesandbox>/sdk/node && npm install && npm run build
npm pack --pack-destination <this-repo>/vendor
# rename to carry the patch it holds, which also stops npm reusing a cached tarball
# of the same name
```

然后把 `gateway/package.json` 指到新版本。

| 包 | 版本 | 许可 | 构建自 |
| --- | --- | --- | --- |
| `@cubesandbox/sdk` | 0.3.0 | Apache-2.0 | TencentCloud/CubeSandbox `9c4837ec` + [#1485](https://github.com/TencentCloud/CubeSandbox/pull/1485) |
