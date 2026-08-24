# AGENTS.md — scripts/

[English](AGENTS.md) | 中文

能从代码树或已构建镜像判定的门禁。哪些检查该放这里而不是 `verify/`，在
[根文件](../AGENTS.zh.md)里；这一页讲的是它既然该放这里，那该怎么写。

## 一个检查是一个文件，而清单点它的名字

`check-<subject>.mjs`，用 `node` 不带参数运行，做一件能用文件名叫出来的事。它要被加进
`check.sh` 里那个循环——那里把每个文件名都写了出来，而不是去 glob 这个目录，所以 grep
一个检查的名字能同时找到它的文件和它被运行的地方；而一个丢进这里却没被加进清单的文件，
哪儿都不会运行。

清单里的顺序是刻意的：它在最常见的错误上失败得最快。一个新检查放在它的失败最有用的
位置，而不是放在末尾。

`check-images.sh` 是那个反过来证明了边界的例外。它是 shell，因为它对已构建的镜像跑
`docker`；它不在 `check.sh` 里也是同一个原因——CI 在构建镜像的那个 job 里跑它。shell
文件在 CI 里要过 shellcheck，按扩展名或 shebang 找出来，所以一个新的 shell 文件在被推
上去之前先过一遍 `shellcheck`。

## 一个检查通过时说什么，失败时说什么

成功时，一行，点出现在成立的那条性质——而不是"检查跑过了"：

```
check-assets: hashed names are immutable, fixed names revalidate
check-plugin-load: every plugin imports without throwing
```

`check: ok` 会是一行活得比它本想描述的那条性质更久的字。这行通过信息同时也是读者了解
这个检查是干什么的地方，因为对多数人来说，这是他们唯一会看到的部分。

失败时，`console.error` 加 `process.exit(1)`。先说这次失败意味着什么，再列出什么失败了，
因为对没写过这个检查的人来说，光是那个列表读起来就是噪音：

```
check-totp: an authenticator app cannot report this — it just fails to let anybody in
check-service-env: this does not fail at runtime — it reports a default as the deployment's answer
```

把所有问题收集起来一起报，而不是遇到第一个就抛。一个在第一个错误上就停下的检查，会把
一次运行变成"有多少个错误就要跑多少次"。

## 一个检查怎么读它要检查的东西

把真东西 import 进来跑，不要重新描述它。一个自带"代码应该产出什么"的副本的检查就是第二
份实现，而它会在两边一起漂移的同时始终与自己相符：

```js
const { SECTIONS } = await import('../admin/sections/index.js')
const { PAGE_SIZE } = await import('../admin/sections/paging.js')
```

用顶层 `await import()` 而不是静态 import，因为这些模块是在检查需要它们的那一刻才为了
导出而被读的；而一个"主题加载不起来"的检查，应该以这个检查的身份失败，而不是在启动时以
一个模块错误的身份失败。

不要自己去派生代码树已经派生的东西。`check.sh` 在循环之前先构建 artifact panel 的浏览器
半边，因为 `check-plugin-load` 读的是那个派生文件——一个读构建产物的检查，是一个必须被
排在构建之后的检查，而不是一个自己去跑构建的检查。

开头的注释承载理由，语气和仓库其余部分一致：什么必须成立，以及它不成立的那次出了什么事。
`check-paging.mjs` 和 `check-docs.mjs` 的注释是写新检查之前最值得先读的两份。
