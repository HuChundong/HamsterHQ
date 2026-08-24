# AGENTS.md — admin/

[English](AGENTS.md) | 中文

运维控制台：自己的服务、自己的凭证，写账户、邀请、设置和审计流水——而不碰任何沙箱。它的
TOTP 是本仓库里唯一被自己写出来的协议，以及为什么它要用 RFC 6238 自己的测试向量来验证，
这些在[根文件](../AGENTS.zh.md)里。

## 一道不开在公共街道上的门

它默认绑在 `127.0.0.1:8091`，这是一个决定，而不是一个可以随手改掉的默认值。

运维不是租户：没有 account 行，没有邮件验证码，这里也没有任何东西去借用一个租户的会话。
`ADMIN_PASSWORD_HASH` 必须能解析成 `scrypt$…`，否则服务退出——宁可不启动，也不要带着一个
默认值启动，因为那等于一个已经公开的密码。`hash-password.mjs` 是唯一被支持的生成方式。

会话是 `hq_admin` 里一个八小时的 JWT，**没有 refresh**：运维重新登录一次，而不是把一个会话
无限期地开着。登录中途那个 challenge cookie 与会话是不同的 audience，所以一次没走完的登录
没法被当成走完了的来出示。

一个未认证的请求，只要目标不是 `/sign-in`，得到的是**401 加上登录页**——控制台就是这样避免
确认自己存在的。

第二因子的 secret 只活在 `settings` 表的 `admin.second_factor` 行里——绝不放进环境变量。它
曾经是一个环境变量，于是一个全新的部署张口就要一个没人扫过的 secret 生成的验证码。注册流程
在落库之前先验证第一个验证码，因为不验证就启用会把运维**永久**锁在外面。

恢复码在内存里以未读状态持有，并且只展示一次。刷新之后不再显示，这是它的性质，不是一个待
修的缺陷。

## 一个 section 是一个文件，而外壳不用动

`console-shell.js` 自己带了一段 "Adding one"，而且它是准确的：写 `sections/<name>.js`，导出
`label`、`icon`、`strings` 和 `render`，然后在 `sections/index.js` 里点它的名字。外壳里什么
都不用改。

`sections/index.js` 记录了它的形状。真正要想清楚的字段是 `needs`——路由在渲染之前读的正好是
一个 section 声明的那些，所以一个去拿自己没声明的数据的 section，是在对着 `undefined` 渲染。

`render(state)` 返回 `{ html, table? }`：table 是给那些在渲染时才组词的句子用的，因为所有
静态的东西已经在 `strings` 里了。

动作都是 `POST`，并且**303 回到那个 section**并带一个 `?done=` 的 notice 码，这样刷新不会
重复提交。fetch 形态的调用方送 `X-Console-Action: fetch`，拿到的是 `{ notice }`。notice 码
必须存在于 `CONSOLE_NOTICES` 里——它住在 gateway 的 `page-chrome.js`，好让
`scripts/check-pages.mjs` 能同时读到两边。

一个未知的 path 回**404，而不是 405**，好让一个缺失的字体不会读起来像一个路由 bug。

`console.js` 里没有任何东西检查调用者。没有 `server.js` 放行它就不可达，而第二处检查会是
让两者产生分歧的第二个地方。不要加。

删除或停用一个账户，是先写数据库再告诉 gateway；而删除失败绝不会被报告成成功。

## 一个列表 section 欠一个大部署什么

`PAGE_SIZE` 是 20。一个列表 section 用 `windowFor(page)` 查询，经 `onePage(rows)` 渲染作为
兜底，并输出 `pager()` 给出的那个控件。

`scripts/check-paging.mjs` 给每个 section 塞两页的量，并要求回来的是一页、且分页控件跟着回
来了。一个新的列表 section 需要在那个检查的 `overfill()` 里加一个分支，点出它读的那个
store；一个长出了 `<tbody>` 却没有分支的 section 会以 "not in overfill map" 失败，那是这个
检查在拒绝猜，而不是在放过一个它并没有实际驱动过的东西。

这不是风格规则。一个无上界的表格，是一个高度由部署的成功程度决定的页面：它在被开发的那台
机器上排版得很好，而当租户列表到达四位数的那天，它就是一份要花一秒才渲染完的文档、一条量
的是表格而不是页面的滚动条、以及一次为了显示某人正在看的那二十行而读了每一行的查询。这三
件事一起到达，而且到达在最没有能力吸收它们的那个部署上。

`scripts/check-env-defaults.mjs` 不扫这个目录，所以
[gateway/AGENTS.zh.md](../gateway/AGENTS.zh.md) 里描述的那条空字符串纪律在这里没有强制，
但依然是必须的。
