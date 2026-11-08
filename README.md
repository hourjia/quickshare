# 快分享

快分享是一个无账户的临时实时共享站点。每个已验证页面都会获得一个 8 位配对码和二维码；两个页面完成独占配对后，可以实时发送文本、链接和文件。

> 界面显示名为「快分享」。为避免破坏既有数据与部署，代码标识（Python 包 `cloudrop`、环境变量前缀 `CLOUDROP_`、Cookie 名、Redis 键前缀等）保持原样，仅界面文案使用「快分享」。

## 已实现的行为

- 每个页面同一时间只能配对一个对端，已配对配对码会立即失效。
- 扫描二维码或手动输入配对码均可发起配对。
- 文本与 HTTP(S) 链接通过 WebSocket 实时转发，只保存在当前页面内存中。
- 文件通过 WebRTC DataChannel 以 16 KB 分块实时发送，不先上传 Django。
- WebRTC 优先直连，失败时使用 Coturn 中继；TURN 也不保存文件。
- 任意一方关闭、刷新或主动断开后，原配对立即失效，存活页面生成新配对码。
- 访问密码通过环境变量注入，授权 Cookie 为 HttpOnly 浏览器会话 Cookie。
- 北京时间同一天累计 10 次密码错误，或同一 IP 连续 5 次错误，会持久化锁定整台服务器。
- 锁定后已有 WebSocket 会被关闭；普通重启不能解锁。修改部署密码并重启后自动解锁并清空失败计数。

## 目录结构

前端与后端已拆成两个可独立构建、独立部署的目录：

```
.
├─ backend/                  # Django + Channels 服务，独立镜像 / 独立进程
│  ├─ cloudrop/              # 项目配置（settings、asgi、urls）
│  ├─ transfer/              # 业务：配对事务、安全锁定、WebRTC 信令、WebSocket consumer
│  ├─ deploy/                # Dockerfile + entrypoint
│  ├─ requirements*.txt
│  ├─ pytest.ini
│  └─ .env.example           # 单独部署后端时的变量清单
├─ frontend/                 # React + Vite 静态站点，独立镜像
│  ├─ src/
│  ├─ scripts/check-node.mjs # 运行时版本校验
│  ├─ deploy/                # 静态托管镜像 + Caddyfile（含 /api、/ws 反代）
│  ├─ .nvmrc / .node-version
│  └─ package.json           # pnpm 11.1.2 / Node 24.22.2
├─ deploy/                   # 组合部署：compose.yaml + 完整 .env.example
└─ AGENTS.md                 # 技术栈与版本锁定
```

## 架构

- `backend/cloudrop`、`backend/transfer`：Django 5.2、Channels、认证安全状态、配对事务与 WebRTC 信令。
- `frontend/`：React 19、Ant Design 6、Vite、TypeScript。
- PostgreSQL：持久化安全状态和短生命周期配对记录。
- Redis：Django Channels 跨进程消息通道，使用独立逻辑数据库和 `cloudrop` 键前缀。
- Caddy：HTTPS、静态前端、`/api` 与 `/ws` 反向代理。
- Coturn：无法建立浏览器直连时实时中继 WebRTC 流量。

### Redis 的作用（为什么不能随手删）

Redis 只承担一件事：Channels 的 channel layer，即 WebSocket 的跨进程消息总线。它承载配对通知、聊天/链接、WebRTC 信令、对端断开通知，以及锁定时的全员广播。

`channel_name` 只是通道层内部的投递地址，真正的实时投递靠 channel layer。因此：

- `UVICORN_WORKERS > 1` 或多副本时，**Redis 是必需的**：两个页面的连接可能落在不同进程。
- 只有单进程（`UVICORN_WORKERS=1` 且单副本）才可以用 `channels.layers.InMemoryChannelLayer` 去掉 Redis。
- 测试模式（`CLOUDROP_TESTING=true`）已自动使用进程内通道，无需 Redis。

## 部署方式一：组合部署（推荐）

前后端仍是两个独立镜像，但由同一个 Caddy 提供同源访问，Cookie 与 WebSocket 都不需要跨域配置。

```bash
cd deploy
cp .env.example .env      # 至少替换域名、DJANGO_SECRET_KEY、CLOUDROP_ACCESS_PASSWORD、DATABASE_URL、REDIS_URL、TURN 相关
docker compose up -d --build
```

容器启动时会自动执行数据库迁移和过期配对记录清理。健康检查地址为 `/api/health`。

如果 PostgreSQL 或 Redis 只在另一个 Docker 网络中暴露、没有宿主机端口，请通过 Compose override 把 `backend` 加入该外部网络，并把连接地址改为对应服务名。

## 部署方式二：前后端分开部署

两个目录各自可独立构建，互不依赖对方的源码：

### 后端

```bash
cd backend
docker build -f deploy/Dockerfile -t cloudrop-backend .
docker run -d --name cloudrop-backend \
  --env-file .env \
  -p 8000:8000 \
  cloudrop-backend
```

也可以直接跑 `uvicorn cloudrop.asgi:application --host 0.0.0.0 --port 8000 --workers 2`，环境变量参考 `backend/.env.example`。

### 前端

```bash
cd frontend
docker build -f deploy/Dockerfile -t cloudrop-frontend .
docker run -d --name cloudrop-gateway \
  -e CLOUDROP_DOMAIN=drop.example.com \
  -e CLOUDROP_BACKEND_UPSTREAM=backend-host:8000 \
  -p 80:80 -p 443:443 -p 443:443/udp \
  cloudrop-frontend
```

也可以只构建静态产物自行托管：

```bash
pnpm install
pnpm build          # 产出 frontend/dist
```

### 拆分部署的关键约束

前端默认与页面同源访问 `/api`、`/ws`（`VITE_API_BASE`、`VITE_WS_BASE` 留空）。这要求 **`/api` 与 `/ws` 必须和前端页面同源**——推荐做法就是让前端镜像里的 Caddy 继续反代到后端，也就是上文的 `CLOUDROP_BACKEND_UPSTREAM`。

如果把前端放到与后端不同的域名：

- 后端需要开放 CORS 白名单，并把会话/CSRF Cookie 改为 `SameSite=None; Secure`；
- 浏览器才会带上凭证，WebSocket 也需要单独配置允许来源。

这套跨域配置当前**没有内置**，属于额外改动。同源部署可以完全避开它。

## DNS 和防火墙

- 将 `CLOUDROP_DOMAIN` 解析到服务器公网 IP。
- 开放 TCP `80`、`443`、`3478`。
- 开放 UDP `443`、`3478`、`49160-49200`。
- 如果服务器位于 NAT 后，`CLOUDROP_TURN_EXTERNAL_IP` 填公网 IP，并把上述 TURN 端口转发到服务器。

## 锁定与运维解锁

锁定状态在 PostgreSQL 中持久化。解除锁定的唯一正常流程：

1. 修改 `.env` 中的 `CLOUDROP_ACCESS_PASSWORD`。
2. 重建或重启后端容器。
3. 服务端检测密码指纹变化后，原子地解除锁定、增加安全代次并清空失败计数。

只重启但不修改密码不会解除锁定。数据库中只保存基于 Django 密钥生成的密码指纹，不保存明文访问密码。

## 本地开发

前端与后端分开启动。后端默认使用 SQLite；实时连接仍需要 Redis，也可以用测试模式的进程内通道进行单进程开发。

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:DJANGO_DEBUG='true'
$env:CLOUDROP_ACCESS_PASSWORD='local-password'
$env:CLOUDROP_TESTING='true'
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe -m uvicorn cloudrop.asgi:application --port 8000
```

另一个终端：

```powershell
cd frontend
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:5173`。若要测试两个页面，请使用两个独立浏览器会话或普通窗口与隐私窗口。

也可以直接在仓库根目录运行 `run-local.cmd`，它会准备环境并同时拉起前后端。

### 运行时版本

前端锁定 Node 24.22.2 与 pnpm 11.1.2（见 `.nvmrc`、`.node-version`、`package.json` 的 `engines` / `volta`）。`pnpm dev`、`pnpm build` 会先执行 `scripts/check-node.mjs`，版本不符时直接失败并提示如何切换版本。

## 验证

```powershell
cd backend
$env:CLOUDROP_TESTING='true'
.\.venv\Scripts\python.exe -m pytest -q

cd ..\frontend
pnpm build
```

### 浏览器注意事项

- 支持 Origin Private File System 的浏览器会先流式写入浏览器私有文件系统，接收完成后显示“保存文件”按钮，不会把 1 GB 文件聚合到 JavaScript 内存。
- 极少数不支持 OPFS、但支持 File System Access API 的桌面浏览器会在接收前让用户选择保存位置。
- 点击“保存文件”后，OPFS 临时副本会延迟一分钟删除；异常遗留的临时文件会在后续打开页面时清理，最长保留 24 小时。
- 1 GB 是协议上限；iOS 是否能完成接收还取决于设备剩余空间和浏览器对当前站点的存储配额。
- 双方必须同时在线；发送方离线后无法重新下载文件。
