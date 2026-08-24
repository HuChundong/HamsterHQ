# AGENTS.md — web/

[English](AGENTS.md) | 中文

nginx、harvest 出来的 shell，以及前门。`patch-loopback.mjs` 是唯一被批准的 harness 补丁，
它的论证在[根文件](../AGENTS.zh.md)里；这里讲的是这个目录其余部分是怎么搭起来的。

## nginx 的三层，以及那个不会被继承的 header

`nginx.conf` 放 listener 和所有全局的东西。`site.inc` 放每一个业务 `location`，并且被 HTTP
和 HTTPS 两个 server 同时 include，所以写一次的路由在两边都被服务。`entrypoint.sh` 在容器
启动时再写两个 include——跳转，以及 `ADMIN_DOMAIN` 被设置时的 admin 虚拟主机——这就是为什么
为控制台加的路由要写进那个脚本，而不是写进 `site.inc`。

一个被代理的 location 必须做的两件事：

- **`proxy_pass http://$gateway_upstream`**，走那个变量。一个字面的 `upstream` 块只在启动时
  解析一次名字，于是一个换了地方的 gateway 会一直 502，直到手工重启 web 容器。
- **自己设 `X-Forwarded-For`。** `proxy_set_header` 不继承：一个只要设了任何 header 的
  location，就丢掉了上层设过的那些。登录限流曾经按伪造的 header 计数，原因正是这个，这也是
  为什么 `scripts/check-forwarded.mjs` 会同时读这个文件和 `entrypoint.sh`，并在一个没写它的
  被代理 location 上失败。登录还需要 `X-Forwarded-Proto`；socket 和事件流需要 `Upgrade` 和
  `Connection`。

## 前门是一份独立的文档

landing 页是 `landing/` 下的一个 Vite 项目，构建到 `dist/`，从它自己的 root 被服务——刻意
不从 shell 的 root，因为 shell 是上游发布的产物，而一个撞名的文件距离被覆盖只有一个 release。

三个 Vite 设置是承重的而不是口味：`base: './'` 让同一份 HTML 既能从项目页服务也能从 `/`
服务，`assetsDir: 'landing'` 让任何东西都不会落到 `/assets/` 里和 shell 自己的哈希文件并排，
`assetsInlineLimit: 0` 让图片保持是文件——被 inline 进一份 `no-cache` 的文档里，它们会在每次
加载时被重新下载。

`scripts/check-landing.mjs` 基本上是一组跨文件断言，这也正是它值得在改这里任何东西之前先读
一遍的原因。它把 landing 的 Vite 产物与 `site.inc` 里的路径、以及 `Dockerfile` 里的步骤对
着断言；它把 `dsh-lang` 和 `dsh-theme` 这两个存储 key 对着 `gateway/src/page-chrome.js` 断
言，因为在前门选的语言必须活着走到登录页；它要求 `landing/` 和 `docs/assets/` 下每一张位图
都是 webp；而且它会数品牌标识的引用次数，好让一份 gateway 资产的副本没法出现在这里。
`scripts/landing-preview.sh` 跑开发服务器。

## 名字里带哈希的，和不带的

一个名字里含有自身内容哈希的资源可以被永久缓存，并以 `immutable` 服务。一个不带哈希的名字
必须被重新验证，而 `no-cache` 是它唯一正确的答案——绝不用 `expires`，绝不用非零的
`max-age`。`scripts/check-assets.mjs` 在 nginx 和 gateway 的页面上双向强制这件事。它在防的
不是一个慢页面：它防的是这样一个部署——一个换过的标识或截图到了一部分访客那里而没到另一部分
那里，而一个访客拿到的是哪一个，取决于他先打开了哪个页面。

`patch-loopback.mjs` 在 `shell` 阶段、`harvest-shell.mjs` 之后运行，并以三种方式让镜像构建
失败，三种都是刻意的：目标文件不在了；shell 已经被 patch 过——这意味着脚本跑了两次，而第二次
无事可做；或者它要匹配的那个表达式不是恰好出现一次，而这正是一次重塑了这个决定的 DSH 升级
的样子。最后那种情况下，错误信息会告诉下一个读者去更新那个表达式，或者——更好——如果这个
release 把那个决定变成可配置的了，就把这个脚本删掉。

因为一次构建可以是绿的、而一个 tag 可以被手工移动，`scripts/check-images.sh` 会去 grep
nginx 实际将要服务的那个 bundle，找那个被 patch 过的值。那条断言抓的是一个丢在缓存层里的
补丁。
