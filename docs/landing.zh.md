# 落地页

[English](landing.md) | 中文

`http://localhost:8080/` 对已登录的租户回应应用本身，对其他所有人回应
[`web/landing/`](../web/landing/)——就在这个地址上提供，而不是跳转到别处。它不去碰任何
其他主机——没有 CDN、没有框架、没有统计——因为部署在私有网络里的一套系统，对外的请求
不是慢，而是根本没人回应。它所用的三款字体——Host Grotesk、DM Sans、Fragment Mono——放在 `web/landing/fonts/`，
只取 latin 子集，三个加起来约 71 KB；它们是
[SIL Open Font License](https://openfontlicense.org)，随这份 MIT 源码一起分发正是该许可
的用途。

同一份文档在 `/plans` 上再提供一次，不问来者是谁。`/` 当不了这个地址：它会把手上有会话
的人送去 `/app`——这对前门是对的，但对前门里唯一一段已登录租户有理由打开的内容就是错
的，也就是「有哪些套餐」。设置 › 账户里那个链接指向的就是它。

它由 [Vite](https://vite.dev) 构建：`index.html`、`styles.css` 和 `main.js`，每个资源
都以带内容哈希的文件名产出，每一处引用都从解析后的文档里改写。这正是资源可以缓存一年、
而文档不缓存的前提——换一张截图就是换一个 URL，它在第一次加载时就到，而不是等旧的过期。
一份构建定义，三处使用：Dockerfile 的 `landing` 阶段、Pages 工作流，以及下面那个开发服务器。

[`gateway/assets/hamster.svg`](../gateway/assets/hamster.svg) 是主标识：透明底、单色线稿，
轮廓由曲率连续的贝塞尔曲线构成；浅色表面使用墨黑，深色表面自动切换为暖白。方形的
`favicon.svg` 复用同一套几何，并针对小尺寸采用更强的光学加粗。填充式的
`web/landing/avatar.webp` 是基于同一侧面轮廓制作的账户头像变体，并不是线稿标识的位图化
版本，应当作为独立变体维护。身体结构、配色、场景职责和复核尺寸统一记录在
[品牌与仓鼠形象规范](brand.zh.md)中。

同一份源码也是 GitHub Pages 上的项目主页，由
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) 发布。正因为要从两个
根目录提供，`base` 才是 `./`、通向应用的链接才是绝对路径；
`scripts/check-landing.mjs` 会把这一点，连同它展示的每一条文案两种语言都在，断言下来。

```sh
scripts/landing-preview.sh        # 开发服务器，边改边刷新
```

页面上的两枚标识属于网关，按真实路径引用（`../../gateway/assets/…`），而不是复制一份
放在页面旁边——这样换掉一枚，落地页和登录页会同时换掉。
