# 在 CubeSandbox 上运行

[English](cubesandbox.md) | 中文

[README.zh.md](../README.zh.md) 里的 Docker 模拟只需要 Docker，是一台笔记本就能跑的那套。
这里是另一套运行时：每个租户一台微虚机——面向真实用户的部署跑的是它，模型密钥能被扣在沙箱
之外也依赖它。前提是已经装好 CubeSandbox、有一个它能拉取的 registry，以及宿主机上的
`cubemastercli`。

```sh
docker compose -f compose.yml -f compose.cube.yml --profile build build

# 沙箱镜像要通过 CubeSandbox 拉得到的 registry 抵达它，而不是本地 Docker 守护进程。
docker tag hamsterhq-sandbox:latest 127.0.0.1:5000/hamsterhq-sandbox:$TAG
docker push 127.0.0.1:5000/hamsterhq-sandbox:$TAG

# 每次都建新模板，而不是更新旧的：模板是创建那一刻拍下的快照，把已有模板指向新镜像，
# 每个沙箱还原的仍是它原来那份快照。把 CUBE_TEMPLATE_ID 指向别名。
#
# 这里没有任何东西预启动沙箱的浏览器：create-from-image 不接受 start 或 ready 命令，
# 所以浏览器改为随每个租户的后端一起启动——后台方式，租户等待的任何东西都不等它。
cubemastercli template create-from-image \
  --image 127.0.0.1:5000/hamsterhq-sandbox:$TAG --alias hamsterhq-sandbox-$TAG \
  --writable-layer-size 20Gi --cpu 2000 --memory 4000

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

- **网关必须被显式放行。** CubeSandbox 允许公网出站的同时拒绝私有网段，使沙箱无法借出网能力
  去够到跑着它的那套基础设施。网关正好在那些网段上，所以创建时把它的地址加进 `allowOut`
  ——见 [`gateway/src/egress.js`](../gateway/src/egress.js)。
