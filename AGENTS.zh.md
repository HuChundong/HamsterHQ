# AGENTS.md

[English](AGENTS.md) | 中文

在这个仓库里怎么干活。每一条规则的存在都是因为违反它付出过代价；
[docs/sandbox-pitfalls.zh.md](docs/sandbox-pitfalls.zh.md) 里有账单。

## DSH 是依赖，而且必须一直是

**永远不要给 harness 打补丁、vendor 它、或者 fork 它。** 它从 npm 来，版本由 `Dockerfile`
里的 `DSH_VERSION` 钉住，租户运行的就是 registry 发布的那个 `lib/bin.js`。一个只有在被改过的
harness 上才成立的改动，不是这个项目能交付的改动。

升级 = 改版本号 + 重新构建 + 跑验收，顺序如此，而且验收不是可选项。本项目依赖的那些 harness
接口（`window.__DSH_BOOT__`、`/plugins`、被钉死在环回的配置方法）都不是有版本承诺的 API，
所以一次升级只有在验收通过之后才算已知可用。

如果 harness 确实做不到需要的事，答案是给上游提 issue、并在这里记一条已知限制——而不是用一个
补丁层悄悄分叉。

**只有一个例外，就是 `web/patch-loopback.mjs`。** DSH 从 `location.hostname` 判断设置面是否
可达，于是任何通过域名访问的部署，其租户什么偏好都留不住——主题、语言、会话设置，一个都不会。
这道锁在上游是有意的，而且在上游是对的：`trustedHosts` 是防 DNS 重绑定的围栏而非认证，所以在
「有真正的认证层」之前，配置面只对 loopback 开放。这套部署就是那个认证层，而且隧道已经让服务端
接受这些写入，只有浏览器不肯发。配置表达不了它，组合顺序绕不过它，而在插件里翻那个标志又必然
晚于 `ui-theme` 的绑定。脚本里写了完整的论证和每一条的证据。

有两样东西防止它变成惯例：它在不再匹配时会让镜像构建**失败**，而不是让某个版本带着「设置又悄悄
回到内存」发布；以及 `scripts/check-images.sh` 会对着 nginx 真正会服务的字节做断言。**不要在它
旁边再加第二个。** 第二个补丁就意味着这个项目开始分叉 harness 了，而上面那条规则的存在正是为了
防止这件事——第一个之所以在这里，只是因为上游对它关着门。

## 加给 DSH 的一切都是 cordis 插件

一处改动属于哪一个插件，由同一个问题决定：**把网关拿掉，这件事还需要吗？** 现在有六个插件
落在这个问题上：

- `dsh-gateway-tunnel` 把沙箱的 `/api` 流量送到网关。它跟着传输走。
- `dsh-sandbox-host` 提供「后端在一台人碰不到的机器上」时浏览器需要的东西：`/files` 上传通道，
  配置文件被读回来、而不是被交给一个并不存在的桌面，以及观察沙箱自己那个无头浏览器的
  `/browser` 通道。它的每一行都能在网关消失后继续成立——
  这既是它不该长在另一个插件上面的原因，也意味着任何把 dsh 跑在远端的人都能直接用它。
- `dsh-tenant-account` 是谁登录着、怎么退出，以及一个自带登录页的部署已经说过一遍的引导步骤。
  没有网关，这些一个字都不成立。
- `dsh-artifact-panel` 是对话旁边的工作区——文件、预览、终端、画布。
- `dsh-scheduled-tasks` 是一个租户的日程：写入它的工具、触发它的定时器，以及侧栏底部那个
  入口。那份持久的列表是网关的，所以它没有一行能在网关消失后成立。
- `dsh-brand` 是外壳内部这套部署自己的标识。

`packages/` 里另外三个包不是插件：`dsh-icons` 和 `dsh-ground` 服务那些没有模块表的界面，
`tunnel-protocol` 是隧道两端共用的帧协议。

一处改动六个都放不进去，说明上面那个问题有了新答案，而不是说明其中某一个该再长出第二个
主题——`dsh-gateway-logout` 就是长到三个主题时被改名的。

四条规则，每一条都真的坏过：

- **按包名引用插件，绝不按路径。** `cordis.patch.yml` 用包名指代插件。客户端模块注册表从配置树
  的 baseUrl 解析插件的 `package.json`，且只扫描它能按名字解析到的包——按路径加载的插件只会挂载
  host 那一半，**完全不贡献 client 半边**，而且不报错。
- **装进 profile，不要装进 `/app`。** Node 解析插件自身的依赖，是从插件所在位置往上走的，
  那条路径永远到不了 `/app/node_modules`。
- **用 `--install-links`。** `npm install <本地路径>` 会建软链指回源码位置，Node 于是从软链
  指向的地方解析插件的依赖，而不是从 profile。
- **只依赖同级。** 一个插件对 `packages/` 里另一个包的依赖写成 `file:../<name>`。更深的相对
  路径只有在每一次镜像拷贝都精确复现目录深度时才成立——而确实有一次没有。

这四条**都不会让构建失败**，它们全都在第一次 `import` 时失败。`scripts/check-images.sh`
存在的意义就是抓这个。

## 不要自己实现别人的协议

**只要一个协议有官方客户端，就用它。** envd——这一族沙箱平台内部都集成的守护进
程——通过官方客户端对话。不要自己实现线协议。官方客户端做不到需要的事，答案是给
上游提 issue，并在本仓库记成已知限制。

官方客户端发不了 `Host` 头——`Host` 是 fetch 的禁止头——而代理的虚拟主机路由需要
一个。代理同时支持路径路由，那才是标准客户端能用的地址。

有三样东西**刻意不采用**，理由都比读到这行字的人活得久：

- `files.watchDir`——envd 看不了网络文件系统，而租户工作区正是。沙箱内那个 Rust
  watcher 就是为此存在的。
- `getMetrics`——按沙箱轮询正是推送模型取代掉的东西。两千个沙箱会让轮询变成负载
  问题。
- `pause`/`resume`——持久化在外部，所以销毁沙箱丢的是工作现场而不是文件。暂停是
  以后要做的决定，不是漏掉的迁移。

`verify/probe-e2b-conformance.mjs` 测的是所配置平台**实际**做得到什么，而不是它声
称什么，并且把已经适配过的差异列出来。它会对着真实平台建一个真实沙箱，所以放在验收
套件旁边而不是 `scripts/` 里，也只在考察某个平台时手动跑，而不是每次提交都跑。

### 渲染模板里不要出现反引号

这个仓库里每个页面都写成模板字符串，里面装着标记、CSS 和脚本——页面本身是一个
`return \`…\``，而长到让人找不到标记的样式表或脚本则单独提成旁边的常量。模板内部的
散文注释里只要出现一个反引号——顺手给一个 CSS 属性名、一个路径、一个变量加的那种——
字符串就在那里结束了。后面的内容被当成表达式解析，于是函数不再返回文档，而是返回那段
算术的结果：`NaN`，运气好的话是一个 `SyntaxError`。

写注释、习惯性地给名字加反引号，页面就会空白回来。**提到名字时不要加反引号。**

`check-pages.mjs` 能抓到它——它渲染每个页面，而一个返回数字的页面不是字符串——但前提
是你跑了它。`node --check` 能更早抓到吵闹的那一半。

### 唯一一个自己写出来的协议

TOTP，在 `admin/totp.js`。RFC 6238 没有线缆格式、没有协商、没有版本——就是一个
HMAC 加一次取模——为这段 `node:crypto` 算术引一个依赖，风险比算术本身更大。

这个例外的代价是 `check-totp.mjs`，而它不是可选的：验证器 App 是个**离线计算
器**。它和本服务之间没有任何一环能报告"两边算得不一样"，所以一个细微写错的实现，
和一个写对的实现，在有人拿着手机进不来之前完全无法区分。用第二份实现去对照证明不
了任何事——两份可以把同一句话读错成同一个样子。它对的是 RFC 里印出来的测试向量，
而"支持 Google Authenticator"真正的含义就是这个。

**如果你把别人的算法写了出来，就要拿那份规范自己公布的答案去测，而不是拿你自己对
它的理解去测。**

## 图标来自 harness

**不要画 `@deepseek-ai/dsh-client-ui-primitives` 已经有的图标。** 它有 70 个，
MIT；每个插件的浏览器半边都可以从 shell 的模块表里 `require` 它，方式和
require React 完全一样。一个窗口里只允许一种图标风格：harness 的 16 网格填充
轮廓。在旁边再画一套，正是这条规矩要防的事。

harness 没有画的那些放在 `packages/dsh-icons`：24 个字形，由 `extract.mjs` 从
lucide-static 写成 path data 并盖上来源版本号。署名见 [NOTICE](NOTICE)。

选 Lucide，是因为决定「一个字形能不能挨着另一个」的两条尺度：它的线宽占框
2/24，harness 是 1.3/16，相差两个百分点——这就是 24 网格的集合能站进 16 网格界面
而不做任何缩放的依据；而且它是描边而非实心，正是 harness「描边扩成填充」的同一
种构造反过来说。`extract.mjs` 会拒绝线宽偏离上游超过十分之一的字形。
lucide-static 是 ISC。

两个坑，都要重建一次才发现。Lucide 用的是整套图元——头是 `<circle>`、画框是
`<rect>`——所以只读 `d` 属性的提取器会**一声不吭地**丢掉一部分图：`users`
提出来是有身子没头，而且什么都没报错。另外，名字对上不等于含义对上，两个方向都
会出错：`copy` 和 `copy-text` 是并排两个按钮，绝不能变成同一个图；而 harness 自
己那个叫 `IconCodeOutline16` 的，画的是一个井号。**看图，别看名字。**

有两个界面无法 require harness 的图标集，这也正是那个包存在的理由，而不只是几
条路径数据。gateway 的页面是 Node 把 HTML 写进模板字符串，落地页是一份静态文档；
两者都没有模块表、没有 React 运行时，所以都从 `dsh-icons` 取标记。一次没有重新走
生成器的 `DSH_VERSION` 升级会让 `check-icons.mjs` 失败。

有两个 client 半边——`dsh-tenant-account` 和 `dsh-sandbox-host`——各内联 1 个自绘
字形。这不是偏好：shell 的模块加载器把这些文件当源码读，`require` 绑的是它自己的
表，所以没有任何构建步骤可以用来解析兄弟包。`check-icons.mjs` 会把那些字节钉在
原件上。

## 目录是有含义的

```
Dockerfile              全部镜像，共用一次 npm install
gateway/  web/  sandbox/  admin/  scheduler/   一个目录对应一个镜像
packages/               本仓库拥有的 npm 包
integrations/           独立存在，抽走不需要改这里一行
verify/                 验收套件——需要一套真实部署
scripts/                仓库门禁——只需要代码树或构建出的镜像
docs/                   设计说明与踩坑记录，默认英文
dev/                    开发用信箱；绝不放在真实用户旁边
vendor/                 因为没有发布，所以被带在这里的东西
```

listing 里看不出来的那几条规则：

- **`integrations/` 不 import 本仓库的任何东西。** 放在那里的东西只跟它所对接的平台说话，
  因此可以整个搬到自己的仓库而不改一行。`cube-volume-juicefs` 是一个 CubeSandbox
  VolumePlugin：它知道 CubeSandbox 和 JuiceFS，对 HamsterHQ 一无所知。如果 `integrations/`
  里的东西需要伸手进这个项目，那它就不是 integration，该放到别处去。
- **`packages/` 装包，且以自己命名。** 目录名就是包名——因为 `cordis.patch.yml` 引用的是包名，
  读的人不该还要在两套名字之间做映射。
- **`gateway/` 不携带任何 harness 代码。** 它认证每一个租户，并持有等同于宿主 root 的 Docker
  socket。往里加 `@deepseek-ai/*` 等于把租户的运行时放进那个唯一不能运行租户代码的进程；
  CI 会断言它不存在。
- **`scripts/` 不需要部署，`verify/` 可能需要。** 凭代码树或构建出的镜像就能判定的检查放
  `scripts/`，在 CI 里跑。需要真实部署、CubeSandbox 安装或真实模型 token 的检查放 `verify/`，
  对着一套部署跑。

## 开 PR 前该跑什么

**没有任何东西是推给 `main` 的。** 每个改动都以 pull request 的形式到达，检查通过，
合并时被 squash；服务端对任何人都拒绝这个推送，包括仓库的所有者。
[CONTRIBUTING.zh.md](CONTRIBUTING.zh.md) 里有路线、分支命名，以及为什么 pull request
自己的标题和描述就是 `main` 最终携带的那条提交信息。

一条命令收齐代码树能判定的全部不变量——lint、插件加载、语言与资源与图标检查：

```sh
npm run check                  # scripts/check.sh：树上门禁清单
scripts/check-images.sh        # 构建之后：什么能解析、什么能加载
```

改某一块时想单独跑一个，仍然只是一个文件：`node scripts/check-docs.mjs`。树上门禁
的唯一清单是 `scripts/check.sh`；加进去的门禁就是 pre-commit 钩子和 CI 都会跑的门
禁。CI 在它之外另跑 shellcheck、compose 配置校验、凭据扫描，以及一个独立 job 构建
镜像并跑 `scripts/check-images.sh`。

**行为改动需要跑验收套件，对着真实部署：**

```sh
cd verify && SANDBOX_RUNTIME=cube COMPOSE_FILE=../compose.yml:../compose.cube.yml \
  GATEWAY=https://host:8443 ./verify.sh
```

它只以被显式告知的地址登录，不会自己找，而且**绝不要指向任何真人的地址**——验收套件直接
从数据库里读验证码，指过去就等于以那个人的身份登录，并在其名下留下会话。

控制台的两项检查已经不需要地址了。控制台是独立服务、有自己的凭据，套件直接在服务内部签发
一个运营会话，而不是借用某个管理员的身份。`VERIFY_ADMIN_URL` 指出该服务在哪，默认
`http://localhost:8091`；没有 admin 服务在跑，这两项就跳过。

它会消耗真实模型 token，并删除所有沙箱，所以只该在你愿意打扰的那套部署上跑。CI 跑不了它——
这恰恰说明：**CI 绿了并不能证明一个行为改动是对的。**

改了 sandbox 镜像还意味着要建新的 CubeSandbox 模板——模板是创建那一刻拍下的快照，把已有模板
指向新镜像，每个沙箱还原的仍是旧快照。见 [README](README.zh.md) 的「在 CubeSandbox 上运行」。

## 部署跟随仓库

部署机是一份 checkout，不是一份拷贝。它用 `git pull` 更新——这也让「那台机器上跑的是哪个
commit」成为一个有答案的问题。此前的做法是从笔记本 rsync，结果那台机器悄悄持有一个比修复
落后两个提交的 `verify.sh`。

```sh
ssh <host> 'cd /path/to/hamsterhq && git pull --ff-only'
```

只读权限由主机上的一把 GitHub deploy key 提供，那台机器推不了任何东西。`.env` 与
`sandbox/egress-ca/*.crt` 被 gitignore、归主机所有，pull 不会碰它们。

**pull 不等于部署。** 租户跑的是镜像，CubeSandbox 下还有由镜像构建出的模板——所以
`gateway/`、`web/`、`sandbox/`、`admin/`、`packages/` 下的任何改动，在重新构建之前
抵达不了任何人，而改了 sandbox 还需要建新模板。只改 `verify/`、`scripts/`、`docs/`
的话，pull 即生效。

**重新构建同样不等于部署。** `docker compose build` 只是把 `:latest` 这个标签挪到新镜像上；
已经在跑的容器仍然用它被创建时的那个镜像，而 `stop` 再 `start` 重启的正是同一个容器。要用
`up -d`——它会把镜像已经变了的容器重建——**不要**在构建之后用 `restart` 或 `stop`/`start`。
这件事没有任何东西会提醒你：构建成功，服务恢复健康，日志一切正常，跑的还是旧代码。要紧的时候
拿容器和标签对一下：

```sh
docker inspect <container> --format '{{.Image}}'   # 必须等于
docker images -q --no-trunc <image>:latest
```

**门禁要在提交之前跑,不是之后。** `git config core.hooksPath .githooks` 会启用一个
pre-commit 钩子,它跑的就是 `scripts/check.sh`——和 CI 起步那份树上门禁同一份清单,快到可以每次都跑。
它的由来是同一个错误犯了五次——把带反引号的散文写进模板字符串,反引号终止了字符串、文件就坏了。
每一次,这些检查里都有一条能在一秒内指出来;而其中两次仍然被提交并推送了,因为输出已经滚过去了。

**构建 `web` 不会移动 sandbox 的标签。** `shell` 阶段是 `FROM sandbox`,所以构建 `web`
会连带构建 sandbox 阶段,插件的浏览器端也会进到 nginx——但 `hamsterhq-sandbox:latest`
仍然指着原来那个镜像,而 CubeSandbox 的模板指着更旧的一个标签。于是同一个插件同时存在于
两处,只构建 `web` 只更新了其中一处。改 `client.js` 时这没问题(浏览器是从 nginx 取的);
改插件的 node 端时,它会**悄无声息地什么都没做**,因为那一半跑在沙箱里。要查,不要假设:

```sh
docker inspect hamsterhq-sandbox:latest --format '{{.Created}}'   # 对比
docker inspect hamsterhq-web:latest --format '{{.Created}}'
```

对齐的做法:`--profile build build`,给 sandbox 镜像打标签并推送,用它**新建**一个模板
(绝不要更新旧模板——模板是创建时拍下的快照),把 `CUBE_TEMPLATE_ID` 指向新别名,再 `up -d`。

**`down -v`的影响超出这套部署。** postgres 的卷里放着账号；而在把 JuiceFS 装在同一个
数据库服务上的宿主机上，它还放着卷文件系统的元数据——那不是租户文件的副本，而是「文件在哪」
的唯一记录。删掉它，对象存储里就只剩没有任何东西能命名的数据块，共享挂载卡死，之后每一次
创建沙箱都变成一个只字未提原因的 `408`。要在删卷之前查，而不是之后：

```sh
docker exec <postgres> psql -U <user> -d postgres -tAc \
  "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')"
```

里面凡是不是这套部署建的，就是别人的；而本项目的 `db.js` 只建一个。

## 一条规则该写在哪

能写下一件事的地方不止一个，而写错了地方的规则，等于被读得太晚、或者根本没被读到。
四个家，按"这段文字是什么"来分，而不是按"它讲的是什么"：

- **这个文件**装的是一个改动在被写出来之前就需要在上下文里的东西：规则本身，加上它被
  破坏时会失败的那个检查的名字。它每个会话都被读一遍，所以这里的长度是其余一切都要
  替它付的成本。
- **某个目录的 `AGENTS.md`** 装的是只对那个目录为真、而这里还没说过的东西。
  `gateway/AGENTS.zh.md` 讲 `gateway/` 里一个页面和一条路由是怎么搭起来的；它不会重述
  gateway 不含 harness 代码这件事，因为这个文件已经说了。
- **[docs/design.zh.md](docs/design.zh.md)** 装比代码活得更久的推理——为什么是这个形状，
  另一条路的代价是什么。**[docs/sandbox-pitfalls.zh.md](docs/sandbox-pitfalls.zh.md)**
  装一次花掉了调试时间的失败，**包括在正确结论之前那个错误的结论**。
- **[CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)** 装一个改动要走的路线，而不是什么让它
  正确。

关于文字本身的两条规则，而且它们恰好是会腐坏的那两条：

**一个事实只有一个家。** 一个被复述到第二个文件里的事实不会一直是副本；它会变成两句
互相矛盾的话，而读者分不出哪句是当下的。链到它的家，而不是重复它——一份以概述本文件
开头的目录规范，已经开始这么坏了。

**一条规则要点出是什么在强制它。** 这里多数规则的结尾都点了 `scripts/` 里某个脚本的
名字，因为那才是它们能在被忘掉之后依然活着的原因：文字说什么为真，而检查在它不再为真
的那一刻再说一遍。一条背后什么都没有的新不变量只是一种偏好，而它会像偏好一样漂移。
如果它能从代码树判定，就放进 `scripts/` 并加入 `scripts/check.sh` 那一份清单；如果不
能，就在文字里说明没有东西强制它，好让下一个读者知道要用自己的眼睛去看。

## 文档

每一页都是一对：英文 `X.md` 与中文 `X.zh.md`，互相链接，`##` 章节相同且顺序一致。英文是默认
入口，也是读者首先落地的那一份。以上全部由 `scripts/check-docs.mjs` 强制执行。

每一份 `AGENTS.md` 旁边都有一个指向它的 `CLAUDE.md` 软链，给那些去找这个名字的工具用——
**要改的是真文件。** `check-docs` 跳过软链而不是给它们配对，因为它们是同一份字节的第二个
名字。

写当下为真的东西。比代码活得更久的推理放
[docs/design.zh.md](docs/design.zh.md)；花掉过排查时间的故障放
[docs/sandbox-pitfalls.zh.md](docs/sandbox-pitfalls.zh.md)，**并且连同正确结论之前那个错误
结论一起写**——那才是读者无法从代码里重建出来的部分。

宁可给测量值，不要给形容词。「每次小文件创建 38ms，本地盘是 0.06ms」能挺过一次重写，「慢」不能。

## 密钥

`.env.example` 是这个家族里唯一进入代码树的成员；`.gitignore` 覆盖 `.env` 与 `.env.*`，
CI 会在发现被跟踪的环境文件、或任何长得像凭据的东西时失败。每套 CubeEgress 安装都会生成自己的
根 CA，所以 `sandbox/egress-ca/*.crt` 被 gitignore，由运维自行放入。

模型密钥归部署所有，且只在 CubeSandbox 下抵达沙箱——由 CubeEgress 在传输途中替换进去。任何时候
都不该把它写进沙箱的环境、日志行或会话事件。
