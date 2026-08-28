# 在 CubeSandbox 上运行

[English](cubesandbox.md) | 中文

[README.zh.md](../README.zh.md) 里的 Docker 模拟只需要 Docker，是一台笔记本就能跑的那套。
这里是另一套运行时：每个租户一台微虚机——面向真实用户的部署跑的是它，模型密钥能被扣在沙箱
之外也依赖它。前提是已经装好 CubeSandbox、有一个它能拉取的 registry，以及宿主机上的
`cubemastercli`。

## 沙箱版本号

每次生产构建都带一个**日期形态**的版本号，不要用 git hash：

- 格式：`YYYY-MM-DD`；同一天发多次用 `YYYY-MM-DD.N`（例如 `2026-08-28.2`）。
- 下面四处必须是同一个串：
  1. 构建参数 `SANDBOX_VERSION`（写入镜像内 `/app/sandbox/VERSION` 与 `env.sh`）
  2. 镜像 tag `hamsterhq-sandbox:<版本>`
  3. Cube 模板别名 `hamsterhq-sandbox-<版本>`
  4. 网关环境变量 `CUBE_TEMPLATE_ID=hamsterhq-sandbox-<版本>`

租户在「设置 → 沙箱」里看到短号（`2026-08-28`）。本机版本与当前部署的
`CUBE_TEMPLATE_ID` 不一致时，页面会提示，Restart 会按当前模板重建机器。

```sh
# 带反爬 Chromium 的生产构建先把二进制抽进构建上下文——从不入库。CI 保持
# sandbox/browser-engine/ 的占位，构建 Playwright 的 shell。前一个模板别名不要
# 动——模板是快照，正在服务租户的那个就是回滚目标。只有新模板 READY 之后，才把
# CUBE_TEMPLATE_ID 指到新别名。
#
# 用当天日期（或 .N）。不要把 git short hash 当作 TAG。
SANDBOX_VERSION=2026-08-28   # 同日再发可用 2026-08-28.2
cid=$(docker create anti-detect-chrome:v3)
rm -rf sandbox/browser-engine && mkdir -p sandbox/browser-engine
docker cp "$cid:/opt/chrome/." sandbox/browser-engine/
docker rm "$cid"
SANDBOX_VERSION=$SANDBOX_VERSION BROWSER_SOURCE=antidetect \
  docker compose -f compose.yml -f compose.cube.yml --profile build build

# 沙箱镜像要通过 CubeSandbox 拉得到的 registry 抵达它，而不是本地 Docker 守护进程。
docker tag hamsterhq-sandbox:latest 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION
docker push 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION

# 每次都建新模板，而不是更新旧的：模板是创建那一刻拍下的快照，把已有模板指向新镜像，
# 每个沙箱还原的仍是它原来那份快照。把 CUBE_TEMPLATE_ID 指向别名。保留前一个别名——
# 回滚就是再指回去然后 `up -d`。
#
# 这里没有任何东西预启动沙箱的浏览器：create-from-image 不接受 start 或 ready 命令，
# 所以浏览器改为随每个租户的后端一起启动——后台方式，租户等待的任何东西都不等它。
cubemastercli template create-from-image \
  --image 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION \
  --alias hamsterhq-sandbox-$SANDBOX_VERSION \
  --writable-layer-size 20Gi --cpu 2000 --memory 4000

# 然后在 .env 里：CUBE_TEMPLATE_ID=hamsterhq-sandbox-$SANDBOX_VERSION
docker compose -f compose.yml -f compose.cube.yml up -d
```

这层 overlay 指明 CubeSandbox API、CubeProxy 节点，以及一个位于宿主地址上的
`GATEWAY_TUNNEL_URL`——沙箱是 Cube 网络上的一台机器，拨不到 compose 的服务名。

这套运行时有三件事值得在开跑之前知道，每一件为什么是这样，见
[docs/design.md](design.md)：

- **模板是通用的。** 它是镜像**运行中**状态的快照，所以镜像不声明 `CMD`；网关拿到租户身份
  之后，才通过 envd 在每个沙箱里启动那一个租户的后端。
- **模型密钥从不进入沙箱。** 沙箱里放的是占位符，真实密钥由 CubeEgress 在请求出站时替换。
  CubeEgress 为此要终止 TLS，所以该安装自己的根 CA 必须被镜像信任——它从不入库，因为每套
  安装都会生成自己的：

  ```sh
  docker cp cube-egress:/etc/cube/ca/cube-root-ca.crt sandbox/egress-ca/
  ```

- **网关必须被允许回来。** CubeSandbox 在拒绝公网出站的同时拒绝私网段，所以沙箱够不到跑着它
  的基础设施。网关落在那些段之一上，创建时加入 `allowOut`——见
  [`gateway/src/egress.js`](../gateway/src/egress.js)。
