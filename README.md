# Noe-SSH

仓库：https://github.com/Wann-99/noe-ssh

基于 Web 的 SSH 可视化终端：多会话、远程文件管理、命令学习。支持 **桌面安装包**、**便携版** 与 **Docker** 部署。

当前版本侧重：React UI、凭据加密、SFTP 流式传输、ProxyJump、可选访问口令。

## 功能特性

### SSH 连接
- 密码 / PEM 密钥 / Passphrase
- HTTP / SOCKS5 代理
- **一级 ProxyJump**（跳板机；代理仅用于连接跳板）
- **X11 转发**（等同 `ssh -X` / `ssh -Y`）：远程 GUI 显示到运行 Noe-SSH 的本机 `DISPLAY`
- **多会话标签**：同时维护多条 SSH 连接
- 连接保存、JSON 导入导出

### 安全
- **凭据保险库**：主密码 + PBKDF2 + AES-GCM 加密本地保存的密码/私钥
- 自动迁移旧版明文 `localStorage` 连接
- Docker / 自托管可选 **`NOE_SSH_ACCESS_TOKEN`** 访问口令（HTTP 登录 + WebSocket 校验）
- 桌面/便携默认仅监听 `127.0.0.1`

### 终端与文件
- xterm.js 终端（主题、搜索、字号、全屏）
- SFTP 浏览 / 上传 / 下载 / 重命名 / 预览（512KB）
- **流式上传下载**（分块传输 + 进度条）
- 命令片段、服务器信息、GUI 操作命令学习日志

## 项目结构

```
noe-ssh/
├── client/               # Vite + React + TypeScript UI
├── shared/               # 前后端共享协议常量
├── src/
│   ├── index.js          # 服务入口
│   ├── http/             # Express + 访问口令
│   ├── ws/               # 多会话 WebSocket Hub
│   ├── ssh/              # SSH / 代理 / ProxyJump
│   └── sftp/             # SFTP 与流式传输
├── electron/             # 桌面壳
├── scripts/              # 打包与冒烟测试
└── dist/client/          # 前端构建产物（由 build:client 生成）
```

## 本地开发

```bash
npm install
npm run build:client   # 首次或前端有改动时
npm start              # http://localhost:3000
```

前后端联调（Vite 热更新）：

```bash
# 终端 1
npm run dev

# 终端 2
npm run dev:client     # http://localhost:5173 ，WS 代理到 :3000
```

冒烟测试：

```bash
npm run test:smoke
```

桌面开发：

```bash
npm run electron:dev
```

## Docker（推荐自托管）

### 给最终用户（无需源码，只设口令）

见 [`deploy/`](deploy/)：拉取已发布镜像，**只改** `NOE_SSH_ACCESS_TOKEN`，其余默认。

```bash
mkdir noe-ssh && cd noe-ssh
curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/.env.example -o .env
# 编辑 .env，填写 NOE_SSH_ACCESS_TOKEN
docker compose up -d
```

访问 http://localhost:3000 ，用口令登录。

### 开发者本地构建

```bash
cp .env.example .env
# 务必修改 NOE_SSH_ACCESS_TOKEN
docker compose up -d --build
```

未设置 `NOE_SSH_ACCESS_TOKEN` 时服务仍可启动，但**不建议**将端口暴露到公网。

### 镜像发布（维护者）

```bash
# 需先 docker login ghcr.io
./docker-publish.sh ghcr.io/wann-99/noe-ssh
```

也可用 `.github/workflows/docker-publish.yml` 打 tag 自动推送。

## 桌面 / 便携版

从 Releases 下载安装包，或本地构建：

```bash
npm run prepare:build
npm run electron:build
npm run package:portable
```

## 使用说明（摘要）

1. （可选）设置主密码创建凭据保险库  
2. 左侧填写主机信息；需要时展开「代理 / ProxyJump」  
3. 连接后使用底部文件面板管理远程文件  
4. 顶部「+」新建会话标签，可并行连接多台主机  
5. 「已保存」中的凭据在解锁保险库后才能解密使用  

## 技术栈

- 后端：Node.js + Express + WebSocket + ssh2  
- 前端：React + TypeScript + Vite + xterm.js + Zustand  
- 通信：WebSocket（终端 + 分块 SFTP）

## X11 转发（ssh -X）

1. 连接表单勾选「X11 转发」；需要完整信任时再勾选「信任 X11」（`-Y`）
2. **运行 Noe-SSH 的机器**上需有可用显示器：`echo $DISPLAY` 非空（或设置 `NOE_SSH_X11_DISPLAY=:0`）
3. 远程 `/etc/ssh/sshd_config` 中 `X11Forwarding yes` 后重载 sshd
4. 连接后终端内 `echo $DISPLAY` 应有值；再运行 GUI 程序（如配置向导）

说明：X11 画面出现在 Noe-SSH **服务端本机**，不是浏览器标签页。Docker 部署需额外挂载 X11 socket，例如：

```yaml
environment:
  - NOE_SSH_X11_DISPLAY=:0
volumes:
  - /tmp/.X11-unix:/tmp/.X11-unix
```

## 注意事项

- 明文凭据不会写入服务端磁盘；仅存在于连接过程的内存中  
- 大文件请使用流式传输（默认路径）；预览仍限制 512KB  
- macOS 未签名应用需在「隐私与安全性」中允许运行；X11 需安装并启动 XQuartz  

