# 贡献指南

[English](CONTRIBUTING.md) | 中文

一个改动怎么从工作副本走进 `main`。改动本身要满足什么，在
[AGENTS.zh.md](AGENTS.zh.md) 里；这一页只讲路线。

## main 只通过 pull request 前进

没有任何东西是推给 `main` 的——一行修复不行，一个文档错别字不行，仓库的所有者本人
也不行。每个改动都以 pull request 的形式到达，检查通过，合并时被 squash。

这件事被强制了两次，而且这两层不是重复。服务端的 ruleset 的 bypass 名单是空的，
所以这个推送对任何人都会被拒绝：

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - 2 of 2 required status checks are expected.
 ! [remote rejected] HEAD -> main (push declined due to repository rule violations)
```

这个拒绝是在对象已经被清点、压缩、发送完之后才回来的，而且它报的是一条规则的名字，
不是一条出路——这就是 `.githooks/pre-push` 存在的理由。它不花一次网络往返，而且它
会说该怎么做。每个 clone 启用一次，连同 pre-commit 那些门禁：

```sh
git config core.hooksPath .githooks
```

钩子是便利，ruleset 才是规则。用 `--no-verify` 绕过钩子推不上去，那只会让失败来得
更晚、更难看懂。

**合并是一个动作，不是一件自己发生的事。** 仓库关掉了 auto-merge，所以一个检查已经变绿的
pull request 会等着，直到有人去合它。关掉它的理由和整栈一次落地是同一个：开在一个栈的最下
层，auto-merge 会在它的检查恰好跑完的那一刻把它落地，而那时上面一层还在评审中；开在 base
是另一个分支的那一层上，它合进的是那个分支而不是 `main`，那是把栈塌掉而不是落地。一个独立
的 pull request 只需要一条命令去合，所以 auto-merge 能买到的东西，不值这两样代价。

## 分支按它承载的东西命名

`<type>/<subject>`，type 取 `feat`、`fix`、`docs`、`chore`、`ci` 之一，subject 是几个
词、中间用连字符：

```
feat/artifact-panel-terminal
fix/upload-channel-content-length
docs/sandbox-pitfalls-mount-lies
chore/dev-standards-and-pr-workflow
```

type 是约定而不是门禁——没有任何东西会因为分支叫了别的名字就拒绝它，因为一个分支只
活一天，合并时就被删掉。但还是值得写对：pull request 列表是靠它来读的。

## pull request 就是提交信息

合并是 squash 的，而 squash 的标题取自 pull request 的标题、正文取自 pull request
的描述。所以标题和描述不是给评审看完就消失的便条——它们就是 `main` 永久携带的那条
提交信息，`main` 上的 `git log` 显示的正是在 pull request 表单里写下的东西。

按这份历史其余部分的读法来写：主题行用祈使句说这个改动做了什么，正文说为什么需要它、
没有它会出什么问题。

```
Refuse a push to main where the reason is still local

The server refuses it too, with a ruleset that has no bypass list, so this
is not what makes main pull-request-only. It is what makes the refusal
legible: a rejected push comes back as a protocol error after the objects
have been sent and names a rule rather than a way forward.
```

**描述要折到 72 列。** GitHub 在构造 squash 信息时会折掉更宽的行，而且它是逐行折而不是重排
整段——于是一行 78 列会变成一行 69 列，加上底下孤零零的一个词。加进这一页的那条提交就是证据：
它的描述里有 36 行超过 72 列，而现在它们在 `main` 上每一行都是两行。没有东西检查这件事，因为
代码树看不见一个 pull request 的描述。

GitHub 还会把它 squash 掉的那些提交的 co-author 追加在一条虚线下面。那个尾注不是你写的，也
不是要去删掉的东西。

这份历史不用 Conventional Commits。`fix(web): …` 是上游 harness 写提交的方式，那是个
讲得通的约定；但它不是这里的约定，而一份历史里混了两种约定，读起来就等于没有约定。

分支上的那些提交是工作草稿，会被 squash 掉，所以它们可以和当时的工作一样乱。没有
任何东西检查它们的格式。

## 当第二个改动需要第一个：stack

有时候一个改动老实说是两个改动，而第二个不看第一个就没法评审。那么第二个 pull request 的
base 是第一个的分支而不是 `main`，这一对就是一个 stack。

**一串 base 分支在 GitHub 认它之前都不是 stack。** 顺序活在 GitHub 自己的 stack 对象里，正是
它把分支规则和检查施加到每一层、并自底向上合并它们。它通过官方的 CLI 扩展来用：

```sh
gh extension install github/gh-stack
gh stack link            # 把一条已有的链变成官方的，自底向上
gh stack view
```

整栈一次落地，squash，这样 `main` 按顺序每层拿到一条提交：

```sh
gh stack merge --yes --squash
```

stack 不会让任何规则变松。`gh stack` 不绕过必需检查，也不绕过那条 pull request 规则——整栈
合并这件事本身就明确不支持绕过合并要求——所以每一层都被按一个独立 pull request 的标准要求。

三条关于工作本身而不是工具的规则，而第一条是最常被做错的那条：

- **修复属于引入这个问题的那一层**，然后向上流进它的子层。改成在最上层修，会让下面那个
  pull request 仍然在交付未修复的代码，并且把这个修复藏起来不让评审它的那个人看见。
- **靠变基整个 stack 来保持各层是最新的**，用 `gh stack rebase` 然后 `gh stack push`，或者
  `gh stack sync`。被重写的推送必须有 lease 保护，并且在远端已经前进时必须中止而不是覆盖；
  裸的 `--force` 是禁止的。
- **一次重写过的推送会让它自己的证据失效。** 变基改变提交的身份，所以锚在旧提交上的评审
  讨论不再能证明某个问题已经解决。每次重写之后，重新读一遍未解决的讨论，以及那些检查。

每一层在它自己的 worktree 里做。共用一个 checkout 的并行修复会落在错误的层里，那就是上面
第一条规则被意外破坏。

因为这里的合并是 squash 的，一层自己的那些提交和任何别的分支一样只是工作草稿——落进 `main`
的是每个 pull request 的标题和描述，每层一条。

## 开 PR 之前跑什么

树内的那些门禁，pre-commit 钩子已经替你跑了：

```sh
npm run check
```

这和 CI 开头的是同一份清单，所以一个过不了它的 pull request 会在大约八秒内让
`everything the tree decides` 变红。它不需要网络、不需要容器、不需要部署。

树决定不了的事情需要更多，这个分界就是 [AGENTS.zh.md](AGENTS.zh.md) 里的那条。构建
之后，镜像里到底解析到了什么、加载得起来吗：

```sh
scripts/check-images.sh
```

而一个行为上的改动需要针对真实部署跑验收套件，这是 CI 跑不了的——CI 绿了并不能证明
一个行为改动是对的：

```sh
cd verify && SANDBOX_RUNTIME=cube COMPOSE_FILE=../compose.yml:../compose.cube.yml \
  GATEWAY=https://host:8443 ./verify.sh
```

它花真实的模型 token，会删掉每一个沙箱，而且它会以你给它的地址登录，所以永远不要把
它指向某个真人的地址。

## 评审在看什么

四个问题，按它们通常出错的顺序排列。每一条都在 [AGENTS.zh.md](AGENTS.zh.md) 里有自己
的家，而且多数由一个失败时会自报名字的检查把守着。

- **harness 还是依赖吗？** 没有东西给它打补丁、vendor 它或者 fork 它，除了那一个被
  记录下来的例外。
- **这该属于哪个插件？** 把 gateway 拿掉——这件事还需要吗？一个改动如果不属于五个
  插件中的任何一个，说明这个问题有了新答案，而不是说其中某个该长出第二个主题。
- **这个改动依赖的规则，是不是只有一个家？** 一个被复述在两个文件里的事实，是一个
  将来会和自己矛盾的事实。理由放 [docs/design.zh.md](docs/design.zh.md)，一次花掉了
  调试时间的失败放 [docs/sandbox-pitfalls.zh.md](docs/sandbox-pitfalls.zh.md)，一个
  目录的局部约定放那个目录的 `AGENTS.zh.md`。
- **如果这是一条新的不变量，它坏掉时什么会失败？** 一条没有东西强制的规则是一条会漂
  移的规则。把检查加进 `scripts/`，加进 `scripts/check.sh` 那一份清单，并在陈述这条
  规则的文字里点它的名字。

文档是被机械检查的，而且很容易忘：每个英文页都有中文配对，两边互相点名，而且两边
带着同样的 `##` 章节。`scripts/check-docs.mjs` 会在一秒内告诉你。
