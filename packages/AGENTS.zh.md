# AGENTS.md — packages/

[English](AGENTS.md) | 中文

六个插件，以及三个不是插件的包。一个改动该属于哪个插件、那四条会在第一次 `import` 时才失败的
安装规则、以及为什么目录名就是包名，这些都在[根文件](../AGENTS.zh.md)里。

## 一个文件是哪一半

一个插件有两半，它们在不同的地方运行，并且是按不同的规则写的。

**host 半**是 `index.js`，在沙箱里的 Node 中运行。它导出 `name`、一个 `apply()`，以及在需要某
个服务时导出 `inject`。`apply()` 即使是空的也必须有：没有它，registry 不会 mount 这个插件，
于是浏览器半边也永远不会被服务——一个空的 `apply()` 读起来就像什么都不做，但它是承重的。

**浏览器半**是 `client.js`，而它不是一个 Node 会去解析的模块。client-module registry 原样把它
服务出去：没有任何东西经过 `node_modules` 解析，没有构建步骤，而它里面的 `require` 是 shell
自己的模块表——React 就是从那里来的。

三个很容易搞错的后果：

- `require` 只能拿到 shell 那张表里有的东西。要别的会在加载时抛，而失败的是整个插件而不是那个
  功能：一个文件里的一处引用错误会把插件一起带走。
- **兄弟包不能被 import。** 没有 bundler 来解析 `dsh-icons`，这就是为什么
  `dsh-tenant-account` 和 `dsh-sandbox-host` 各自把一个 glyph 以 path data 的形式内联携带。
- 刻意只有一个文件。第二个文件会是一个 shell 永远不会去取的第二个模块。

`dsh-gateway-tunnel` 完全没有浏览器半边，这也正是它成为唯一缺席 harvest 组合的插件的原因。

## 唯一带构建步骤的包，以及为什么

`dsh-artifact-panel` 是那个例外：它需要 xterm，而 shell 的模块表里有 React，没有别的它能用的
东西。所以它用 esbuild 打包成 `lib/client.js`，形态是 IIFE 且把 `require` 留作 external，并在
`package.json` 里把那个产物声明为自己的 client 入口。

`lib/` 是 gitignore 的——它是派生物——而 `scripts/check.sh` 会在跑任何检查之前先构建它，因为
`check-plugin-load` 读的是被服务出去的那个文件，否则它读到的会是上一次那份。一处改了面板源码
却没有重新构建的改动，是一处没有任何检查看过的改动。

这里其余每个包都是"源码即发布物"，而给第二个包加上 bundler 这件事应该被论证，而不是被默认。

## 读每一个包的那两个检查

`scripts/check-plugins.mjs` 读每一个 `client.js`，找的是那些"半翻译的界面不会自己报告"的东西：

- 中文只可以出现在 `DICTIONARY` 里面。出现在别处的可见字符串，是一个语言开关到不了的字符串。
- 每个条目都要有 `zh` 和 `en` 且非空，而每个 `t('key')` 都要与字典双向对应——一个孤儿 key 和
  一个缺失的 key 都是失败。
- 一个调用 `t()` 的组件必须持有 `const t = useT()`。class 组件持有不了 hook，所以它用 `say()`
  代替；而一个两者都没有却调用了 `t()` 的组件，能通过其他每一个检查，然后在首次渲染时抛
  `t is not defined`。
- 不能用可见的中文做 DOM 选择器，因为把那个字符串翻译了，查询就坏了。

`scripts/check-plugin-load.mjs` 在一个 vm 里、用一个 stub 过的 `require` 执行被服务出去的
client，并要求它 import 时不抛、注册了自己的 loader entry、导出了 `apply()`、并且 `inject`
给的是一个数组。它存在是因为一个加载失败的插件会把整个页面带走，而租户看到的那个错误报的是
一个变量名，而不是一个插件名。

一个新插件还要按这个顺序碰：`sandbox/cordis.patch.yml`（按**包名**）、如果它有值得烤进 shell
的浏览器半边则还有 `sandbox/harvest.patch.yml`、`Dockerfile` 里那条 `--install-links` 装进
profile 的安装、以及如果它的依赖必须从那里解析得到则还有 `scripts/check-images.sh`。然后是
重建——sandbox 镜像，而如果是 client 的改动，还有 `web`。
