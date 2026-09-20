# 本机 Docker 验收

[English](local-docker.md) | 中文

## Model credentials

Docker 是本机模拟运行时。使用[开发模型代理](../dev/model-proxy.mjs)和
[Compose 覆盖文件](../dev/model-proxy.compose.yml)：只有代理服务只读挂载操作员的
源环境文件，gateway 和 sandbox 只收到非秘密占位值及内部代理地址。代理固定使用
配置的上游，只接受模型 API 路径，拒绝重定向，不记录请求头或响应正文，不发布宿主端口。
scripts/check-dev-proxy.mjs 在树检查中验证这些代理行为。

源环境文件权限保持 0600。若不使用仓库的 .env，通过 MODEL_SOURCE_ENV 指定绝对路径。
不要把真实模型凭据写入本机部署环境文件或数据库设置。数据库模型设置会覆盖环境变量，
因此验收应使用全新的 Compose 项目和数据库。

## Run and verify

**必须使用没有用户沙箱的独立 Docker daemon 或主机。** 运行时采用固定的沙箱归属标签；网关启动时会删除带此标签但不在自身数据库中的沙箱。验收脚本只删除两个验证账号的沙箱，但这不能隔离网关启动时的清理。仅新建项目、数据库和网络不能隔离这一步清理。不要在日常部署使用的 Docker daemon 上运行套件；DSH_LABEL 不是可配置的隔离手段。

从 .env.example 准备独立环境文件，例如 /tmp/dsh-sidebar.env。生成新的会话和数据库
秘密，设置 SANDBOX_RUNTIME=docker，并通过 EMAIL_API_URL=http://mailbox:8025/emails
使用开发邮箱，RESEND_API_KEY 使用开发占位值。MODEL_API_KEY 设置为
local-proxy-placeholder，MODEL_BASE_URL 设置为 http://model-proxy:8098/v1。
仅复制源环境文件中的模型 ID/API 元数据，不复制其凭据。选用空闲端口。setup-local 生成唯一的 COMPOSE_PROJECT_NAME 与匹配的
COMPOSE_NETWORK；二者不能隔离沙箱清理。不设置 AGENT_PYTHON_PACKAGES，以保留完整 sandbox 工具链。

从仓库根目录执行。setup-local 会生成新的环境及管理员密码文件，拒绝覆盖现有文件，
仅复制模型元数据且不修改源文件权限；环境内没有真实模型凭据。可用 LOCAL_PROJECT_NAME 指定生成的项目名。只有复用可丢弃的验收部署时才跳过 setup-local：

```sh
node dev/setup-local.mjs .env /tmp/dsh-sidebar.env
export COMPOSE_ENV_FILES=/tmp/dsh-sidebar.env
unset COMPOSE_PROJECT_NAME COMPOSE_NETWORK
export COMPOSE_FILE="$PWD/compose.yml:$PWD/dev/model-proxy.compose.yml"
docker compose --profile dev --profile build build sandbox desktop web gateway admin scheduler
docker compose --profile dev up -d
scripts/check-images.sh
npm --prefix verify ci
(cd verify && npx playwright install chromium)
cd verify
SANDBOX_RUNTIME=docker GATEWAY=http://localhost:18090 ./verify.sh
```

使用本机环境文件配置的 gateway 端口。验收默认邮箱是测试接收地址，绝不能替换为真实
人员邮箱。模型轮次通过代理消耗真实 token，验收会删除两个验证账号的沙箱。
代理只用于开发，不改变 CubeSandbox 的凭据注入方式。

完整桌面验收前，在本机环境文件设置 LOCAL_SANDBOX_IMAGE=hamsterhq-desktop:latest，
然后执行 docker compose up -d gateway。先在隔离 daemon 上删除两个验证账号已有的沙箱，
让下一次请求创建桌面镜像容器。如果 Chromium 在默认 512 PID 限制下报 pthread_create
资源不足，在本地 Compose override 的 gateway environment 中设置 SANDBOX_PIDS_LIMIT: 1024，
再重建 gateway 容器和验证沙箱；该额度也计算线程。请从 verify 目录运行以下验收命令，
并保留上述 Compose 环境变量：

```sh
VERIFY_DESKTOP=1 SANDBOX_RUNTIME=docker GATEWAY=http://localhost:18090 ./verify.sh
```

远程部署不提供上游的宿主原生应用启动入口；runtime 与静态壳 composition 均禁用
该入口的两个插件。文件和终端使用工作区及 Computer 的现有入口。
scripts/check-dockerfile.mjs 检查两份 composition，避免浏览器请求缺失的原生应用路由。
