# 在 CubeSandbox 上运行

[English](cubesandbox.md) | 中文

[README.md](../README.md) 里的 Docker 模拟只需 Docker，适合笔记本。这是另一条运行时：每个租户一台 microVM，真人部署走这条，模型凭证的扣留也依赖它。前提是已安装 CubeSandbox、有可拉取的 registry，以及主机上的 `cubemastercli`。

## 两套镜像，一个默认

| 镜像 | Cube 别名前缀 | 创建规格 | 角色 |
|---|---|---|---|
| `hamsterhq-desktop` | `hamsterhq-desktop-<version>` | 4 CPU / 8 GiB，writable 8Gi | **默认。** XFCE + TigerVNC + noVNC + 有头 Chrome |
| `hamsterhq-sandbox` | `hamsterhq-sandbox-<version>` | 2 CPU / 4 GiB，writable 8Gi | 轻量回滚；仅无头 CDP |

`CUBE_TEMPLATE_ID` 指向 **desktop** 别名（全员）。轻量别名照常构建打 tag；回滚就是把 `CUBE_TEMPLATE_ID` 指回去再 `up -d`。可选在 `.env` 里写 `CUBE_TEMPLATE_ID_LIGHT` 给运维备忘——网关不读它。

## 沙箱版本

每个生产沙箱构建带一个**日期形**版本，绝不用 git hash：

- 形式：`YYYY-MM-DD`，同日多次发布用 `YYYY-MM-DD.N`（例如 `2026-08-28.2`）。
- **默认（desktop）**路径上四处必须一致：
  1. Docker build arg `SANDBOX_VERSION`（写入 `/app/sandbox/VERSION`）
  2. 镜像 tag `hamsterhq-desktop:<version>`
  3. Cube 模板别名 `hamsterhq-desktop-<version>`
  4. 网关环境 `CUBE_TEMPLATE_ID=hamsterhq-desktop-<version>`

租户在设置 → 沙箱看到短形式。机器版本与当前 `CUBE_TEMPLATE_ID` 不一致时，页面会说明，重启会按当前模板再建一台。

## 什么会冻进 desktop 模板

Cube 0.7 的 `create-from-image` 接受 `--cmd` 和 `--probe`。desktop 镜像用它们把**与租户无关**的栈冻进内存快照：

- dbus、TigerVNC `:0`、XFCE、`127.0.0.1:6080` 上的 noVNC、有头 Chrome + CDP `:9222`，以及 `:6099` 上的小 health
- 隐藏 noVNC 侧栏与连接状态条（`vnc.html` 上挂 CSS + 内联样式，与 weixin-bot 蓝本相同），Computer 面板只剩桌面
- XFCE 壁纸种子为 `/usr/share/backgrounds/hamsterhq/desktop.jpg`
- 默认浏览器为 `/usr/local/bin/chrome-launch`（`BROWSER_SOURCE=antidetect` 时走 `/opt/chrome`，否则 apt Chromium），经 mimeapps 与 XFCE `helpers.rc` 接到面板 / exo-open

镜像仍然**不**声明 `CMD`。`--cmd /app/sandbox/template-warm.sh` 只覆盖模板构建那一次启动。还原后 `entrypoint.sh` 启动 dsh / 隧道 / reporter（租户才可知），并调用 `start-desktop.sh`——端口已在听时是空操作。

禁止冻结：dsh、网关隧道、reporter、workspace / migrate。

## 构建与切换

```sh
# 生产若带反爬 Chromium，先把宿主机**最近一次编译**的 chrome-dist 同步进构建
# 上下文——二进制从来不进 git。CHROME_DIST 指向 Chromium 工作区刚产出的
# chrome-dist/，不要从旧的打包镜像（例如 anti-detect-chrome:v3）再 docker cp。
# CI 保留 sandbox/browser-engine/ 占位并用 Playwright 的 shell。前一个模板别名
# 留着——模板是快照，正在服务租户的那个就是回滚目标。只有新模板 READY 之后，
# 才把 CUBE_TEMPLATE_ID 指过去。
#
# 用今天的日期（或 .N）。不要用 git short hash 当 TAG。
SANDBOX_VERSION=2026-08-29   # 同日重建用 2026-08-29.2
CHROME_DIST=${CHROME_DIST:?设为工作区 chrome-dist/ 路径}
test -x "$CHROME_DIST/chrome"
mkdir -p sandbox/browser-engine
rsync -a --delete --exclude README "$CHROME_DIST"/ sandbox/browser-engine/
SANDBOX_VERSION=$SANDBOX_VERSION BROWSER_SOURCE=antidetect \
  docker compose -f compose.yml -f compose.cube.yml --profile build build sandbox desktop

# Cube 节点能拉取的 registry。
docker tag hamsterhq-desktop:latest 127.0.0.1:5000/hamsterhq-desktop:$SANDBOX_VERSION
docker tag hamsterhq-sandbox:latest 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION
docker push 127.0.0.1:5000/hamsterhq-desktop:$SANDBOX_VERSION
docker push 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION

# Desktop 模板：先热起栈再快照。
cubemastercli template create-from-image \
  --image 127.0.0.1:5000/hamsterhq-desktop:$SANDBOX_VERSION \
  --alias hamsterhq-desktop-$SANDBOX_VERSION \
  --writable-layer-size 8Gi --cpu 4000 --memory 8000 \
  --cmd /app/sandbox/template-warm.sh \
  --expose-port 6099 --probe 6099 --probe-path /health

# 轻量模板（仅回滚；不冻结）。
cubemastercli template create-from-image \
  --image 127.0.0.1:5000/hamsterhq-sandbox:$SANDBOX_VERSION \
  --alias hamsterhq-sandbox-$SANDBOX_VERSION \
  --writable-layer-size 8Gi --cpu 2000 --memory 4000

# 然后在 .env：
#   CUBE_TEMPLATE_ID=hamsterhq-desktop-$SANDBOX_VERSION
#   CUBE_TEMPLATE_ID_LIGHT=hamsterhq-sandbox-$SANDBOX_VERSION   # 运维备忘
docker compose -f compose.yml -f compose.cube.yml up -d
```

每次都建新模板，不要更新旧的。保留前一个 desktop 别名——回滚就是把 `CUBE_TEMPLATE_ID` 指回去（或指到轻量别名）再 `up -d`，并释放在跑的沙箱让租户落到新模板。

overlay 会写明 CubeSandbox API、CubeProxy 节点，以及主机地址上的 `GATEWAY_TUNNEL_URL`——沙箱在 Cube 自己的网络上，拨不通 compose 服务名。

跑起来之前还有三件事值得知道，[docs/design.md](design.md) 解释了各自为什么这样：

- **对租户状态而言模板是通用的。** 镜像 `CMD` 仍为空；网关经 envd 为每个租户起后端。桌面图形可用 `--cmd`/`--probe` 冻结，因为它们不需要租户身份。
- **模型凭证从不进入沙箱。** 沙箱里是占位符，请求离开时由 CubeEgress 替换真密钥。CubeEgress 为改写而终止 TLS，所以安装自己的根 CA 必须在镜像内受信任——从不入库，因为每次安装都会自生成：

  ```sh
  docker cp cube-egress:/etc/cube/ca/cube-root-ca.crt sandbox/egress-ca/
  ```

- **网关必须被允许回来。** CubeSandbox 在公网出口之外还会拒绝私网段，沙箱够不到跑它的基础设施。网关落在那些段之一，创建时写入 `allowOut`——见 [`gateway/src/egress.js`](../gateway/src/egress.js)。
