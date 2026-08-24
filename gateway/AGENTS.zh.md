# AGENTS.md — gateway/

[English](AGENTS.md) | 中文

nginx 后面的会话面：浏览器从不直接到达它。它不携带 harness 代码、以及被渲染的模板里的
prose 不能出现反引号，这两条在[根文件](../AGENTS.zh.md)里。

## 一条路由放在哪，以及它必须问什么

这里没有框架。`src/server.js` 里的 `handleRequest` 是一条有序的 `if` 链，而顺序就是路由
表——一条具体的 path 要排在 `/api` 那个兜底之前，不是之后。

读 body 只能通过 `readBody(req, limit)`。它到上限就销毁请求，而不是截断，所以调用方拿到的
是 `undefined`，永远不会是一个半解析出来的对象。

**永远不要在路由里直接调 `authenticate`，要调 `callerOf(req, res)`。** 它做认证，并且在
token 被续期时把 cookie 设到响应上。一条自己去认证的路由会得到正确的答案却丢掉那次续期，
于是浏览器在它的下一个请求上被登出——失败比错误晚到一个请求，而且出现在一个看起来毫无
问题的页面上。

`renewedAsHeaders` 那个形态是为 nginx 的 `auth_request` 存在的，后者会丢弃 subrequest 自己
的 `Set-Cookie`。而唯一能把 header 带回去的变量 `$upstream_http_set_cookie` 只保留同名
header 中的第一个，这就是为什么两个续期 cookie 要用两个不同名字的头送出去。

`/_internal/account` 对错误或缺失的 secret 回**404，而不是 403**，并且在
`INTERNAL_SHARED_SECRET` 未设时拒绝每一次调用。它是在藏，而不是在宣告：403 等于告诉猜中
的人这个端点是真的。

客户端地址来自 `src/send-limit.js` 里的 `callerAddress`，它读 `X-Forwarded-For` 的**最后**
一跳。这只有在 nginx 于每一个被代理的 location 上都覆写了这个 header 时才成立，而
`scripts/check-forwarded.mjs` 就是对着 `web/site.inc` 和 `web/entrypoint.sh` 断言这件事的
——登录限流曾经按伪造的 header 计数，那是一个并不存在的限流。

## 一个页面由什么构成，以及什么在读它

一个页面是一个模块，导出一个返回文档的函数，样式表作为模块级常量放在它旁边。所有共享的
东西都来自 `src/page-chrome.js`——`documentHead`、各套配色、field 与 ground 的 CSS、
wordmark、主题与语言开关、toast 码表——而它是被 import 的而不是被复制的，`admin/` 也一样。

markup 自己承载的两条规则：

- **中文是 markup，英文是表。** 文字以中文待在文档里，带一个点出它 key 的 `data-t` 属性，
  由 `langToggle(table)` 把这一对以 JSON 注入。一个加了却没有 key 的字符串不会报错也不会
  打日志：它就那样以中文留在英文界面里。
- **资产 URL 来自 `asset()`**，绝不手写。`src/page-assets.js` 在启动时对 `assets/` 下的
  内容做哈希，文件缺失就在那里抛出，所以缺一个资产会让进程停住，而不是之后 404。手写的
  路径没有任何东西会去服务它。

新增一个页面意味着把它按**每一个 UI 状态**都加进 `scripts/check-pages.mjs`，因为那个检查
是渲染页面而不是读页面——状态才是藏着未翻译字符串的地方。如果它点了某个图标或资产的名字，
`scripts/check-icons.mjs` 和 `scripts/check-assets.mjs` 里的文件清单也要加上；这两个都不会
去遍历目录，所以一个没被列进去的页面就是一个没被检查的页面。

## 配置，以及从配置里许下的承诺

**用 `firstOf()`，不要用 `??`。** `??` 问的是一个变量是否存在；而 compose 把每个可选变量
都以空字符串交过来，所以它存在，于是那个 fallback 永远不会跑。一个 URL 于是在生产环境里
变成 `fetch('')`。`scripts/check-env-defaults.mjs` 会把 `compose.yml` 里所有 `${VAR:-}` 读
出来，并拒绝对它们使用非空的 `??` fallback——但它只扫 `gateway/src/*.js`，别的不扫，所以
`admin/` 里的同一条纪律要靠你自己。

一个两个服务都读的变量，必须在**两个** compose 块里都声明。
`scripts/check-service-env.mjs` 会跟着两边的 import 链走，并在 gateway 被给了而控制台没被
给时失败——否则控制台会把一个默认值当作这个部署的答案报出来，那比什么都不报更糟。

`SESSION_SECRET` 短于十六个字符、以及 `RESEND_API_KEY` 缺失，都会在启动时退出，而不是带着
残缺启动。

`src/entitlements.js` 里的每个字段都必须在 `gateway/src` 的别处被读到，
`scripts/check-entitlements.mjs` 会在某个没被读到时失败：一个加进某个 tier 却没有任何东西
去执行的数字，是一个背后没有机制的承诺。

schema 是 `src/db.js` 里的一个字符串，每次启动都用 `CREATE TABLE IF NOT EXISTS` 重跑一遍。
这里没有 migration 历史——开发期变过的列是在它自己的 `CREATE TABLE` 里变的——所以那个字符
串是一张创建的许可证，而不是重塑一个已经存在的数据库的许可证。加进它的一个列只会出现在空
的部署上，别处都不会。
