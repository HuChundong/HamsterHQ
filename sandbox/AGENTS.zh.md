# AGENTS.md — sandbox/

[English](AGENTS.md) | 中文

一个租户的 backend 由什么构成。这里的改动需要一个**新的** CubeSandbox template 而不是给镜像
重新打标签、以及 envd 要通过它的官方客户端来说，这两条在[根文件](../AGENTS.zh.md)里。

## 没有 CMD，以及由此而来的顺序

这个镜像不启动任何东西。一个 CubeSandbox template 是镜像**运行中**状态的快照，所以一个由镜像
启动的 backend 会是一个被冻进每一个快照里的 backend；gateway 改为通过 envd 的进程 API 来启动
`entrypoint.sh`。

那个脚本里的顺序不是随意的：

1. `source /app/sandbox/env.sh`，因为 envd 不会把镜像自己的 `ENV` 交给进程。
2. 创建 workspace 和 `DSH_HOME`，并把镜像的 profiles 软链进租户的那份——profiles 是镜像内容，
   workspace 是租户的。
3. 检查 layout 版本并迁移。`SANDBOX_LAYOUT_VERSION` 和 `migrate-storage-paths.mjs` 是一起动
   的；只改其中一个的 layout 变更，会把租户的文件留在没有东西去找的地方。
4. 后台启动 dsh。
5. 后台启动 reporter，如果它在的话。
6. ensure 显示栈（desktop 镜像用 `start-desktop.sh`）或无头浏览器（轻量镜像用
   `start-browser.sh`）。Desktop 的 Cube 模板在 `create-from-image` 时冻结 KDE/VNC；有头
   Chrome 保持停止，直到桌面或 `playwright-cli` 首次请求，因为它的 profile 是持久卷上的租户状态。
7. `wait` dsh，而且只 wait dsh。

tunnel 是那个组合里的一个插件，不是第二个进程，所以只有一样东西要等，也没有什么需要与它保持
同步。

**在这里新增一个常驻进程，位置在 dsh 之后、`wait` 之前，并且不要 wait 它。** 一个 reporter
死掉的沙箱应该继续为它的租户服务；发现这件事的是 gateway 自己的静默超时。

## reporter 是 Rust 写的，而镜像会检查它跑不跑

`agent/` 构建出 `dsh-agent`：指标、对 workspace 的一个 inotify watch，以及把这两样带给
gateway 的那个 reporter。它存在是因为 envd 没法 watch 一个网络文件系统，而租户的 workspace
正是一个。

要改它，你需要知道的是：

- 它在 `agent-build` 阶段用 `cargo build --release --offline` 构建，所以一个新 crate 需要它
  的 vendored 源码，而不只是 `Cargo.toml` 里的一行。
- `sandbox` 阶段会跑一下这个二进制并 grep `unknown command`。那是架构检查：为错误架构构建的
  二进制会以 `exec format error` 失败，而这条断言让它在构建里被抓到，而不是在某个租户的沙箱
  里。
- `dsh-agent watch <dir>` 单独跑那个 watcher，打印 JSON 行。这是在没有 gateway 的情况下看它
  发出什么的办法。
- 这个仓库里没有 `cargo test`。消费这些事件的面板路径逻辑是在 JavaScript 那一侧由
  `scripts/check-panel-paths.mjs` 测的，所以对 Rust 的改动是靠**跑它**来验证的，而且不会有
  任何东西告诉你不是这样。

改了 Rust 却只重建 `web`，会把旧的二进制留在 sandbox 镜像里——那正是根文件从另一个方向描述过
的那个陷阱。

## 两套组合，以及运维放进来的那个 CA

三个 patch 文件，而一个插件该属于哪一个是不可互换的：

- `cordis.patch.yml` 是一个租户的沙箱真正运行的东西。`dsh-gateway-tunnel` 在这里，别处都没有。
- `harvest.patch.yml` 只在构建时用，用来 harvest 那个静态 shell。`dsh-brand` 在这里，而**不在**
  运行时的组合里，因为浏览器加载的那个 shell 里已经带着它了。
- `cordis.model.patch.yml` 是只在 `MODEL_PROVIDER_ID` 被设置时才叠上去的第二层。

一个被放进错误文件里的插件，要么对谁都不加载，要么加载两次，而这两种在构建时都不会说话。

`egress-ca/` 放 CubeEgress 的根 CA，而每个安装都自己生成一份，所以那些证书是 gitignore 的，
由运维拷一份进来。镜像用 `update-ca-certificates` 安装它——然后还要设 `NODE_EXTRA_CA_CERTS`，
因为 Node 是对着它自己内置的根证书验证的，完全忽略系统的那套。两者缺一，沙箱在本该拿到模型
响应的地方拿到的是证书错误。
