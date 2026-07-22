# Noe-SSH

仓库：https://github.com/Wann-99/noe-ssh

基于 Web 的 SSH 可视化终端：多会话、远程文件管理、命令学习。支持 **桌面安装包**、**便携版** 与 **Docker** 部署。

当前版本侧重：React UI、凭据加密、SFTP 流式传输、ProxyJump、账号登录与操作审计。

## 功能特性

### SSH 连接
- 密码 / PEM 密钥 / Passphrase
- HTTP / SOCKS5 代理
- **一级 ProxyJump**（跳板机；代理仅用于连接跳板）
- **X11 转发**（等同 `ssh -X` / `ssh -Y`）：远程 GUI 显示到运行 Noe-SSH 的本机 `DISPLAY`
- **多会话标签**：同时维护多条 SSH 连接
- 连接保存、JSON 导入导出

### 安全与审计
- **凭据保险库**：主密码 + PBKDF2 + AES-GCM 加密本地保存的密码/私钥
- 自动迁移旧版明文 `localStorage` 连接
- Docker / 自托管推荐 **账号密码登录**（`NOE_SSH_ADMIN_*` + SQLite 用户表）
- 遗留可选 **`NOE_SSH_ACCESS_TOKEN`** 单口令模式
- **操作级审计**：登录、SSH 连接/断开、SFTP 写操作（不含终端逐键、不含密码/私钥）
- 管理员后台：用户管理、审计查询、连接概览
- 桌面/便携默认不启用账号体系，仅监听 `127.0.0.1`

### 终端与文件
- 每个 SSH 会话独立的 xterm.js 终端（历史、搜索、字号、全屏）
- SFTP 浏览 / 上传 / 下载 / 新建 / 重命名 / 删除与快捷键操作
- CodeMirror 6 多标签编辑器：JSON、JavaScript/TypeScript、Python、Markdown、HTML/CSS、Shell、YAML、XML、SQL 等语法高亮（1MB）
- **流式上传下载**（分块传输 + 进度条）
- SSH、WebSocket 与 SFTP 独立状态反馈，断线后不会显示为“已连接”
- 命令片段、服务器信息、GUI 操作命令学习日志

## 项目结构

```
noe-ssh/
├── client/               # Vite + React + TypeScript UI
├── shared/               # 前后端共享协议常量
├── src/
│   ├── index.js          # 服务入口
│   ├── http/             # Express + 认证 / 管理 API
│   ├── db/               # SQLite 用户与迁移
│   ├── audit/            # 操作审计写入与查询
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

### 账号模式（推荐）

设置管理员密码后，服务以 SQLite 持久化用户与审计日志（compose 挂载 `./data` → `/data`）。

```bash
mkdir noe-ssh && cd noe-ssh
curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/.env.example -o .env
curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/docker-start.sh -o docker-start.sh
chmod +x docker-start.sh
# 编辑 .env：填写 NOE_SSH_ADMIN_PASSWORD（可选改 NOE_SSH_ADMIN_USER）
./docker-start.sh
```

访问 http://localhost:3000 ，用管理员账号登录。管理员可在「管理后台」创建普通用户、查看审计。

### 遗留单口令

未设置 `NOE_SSH_ADMIN_PASSWORD` 且库中尚无用户时，可仅设置 `NOE_SSH_ACCESS_TOKEN` 使用旧的共享口令门禁。一旦启用账号模式（库中已有用户），则走账号密码登录，不再把共享口令当作长期会话令牌。

### 开发者本地构建

```bash
cp .env.example .env
# 务必修改 NOE_SSH_ADMIN_PASSWORD
./docker-start.sh
```

未设置任何认证时服务仍可启动（桌面/便携默认），但**不建议**将端口暴露到公网。

### 审计与隐私边界

服务端记录：登录成败、SSH 连接/断开（主机/用户/端口）、SFTP 新建/重命名/删除/上传/下载/打开编辑/保存。  
**不记录**：终端逐键输入输出、SSH 密码、私钥内容。侧边栏「记录」仍为浏览器本地学习日志，与管理后台服务端审计相互独立。

## 版本升级与发布（维护者）

每次发新版本按下面做即可。约定：镜像仓库 `ghcr.io/wann-99/noe-ssh`，版本号改 `package.json` / `client/package.json`。

### 1. 改代码并自测

```bash
# 前端有改动时
npm run build:client

# 可选：冒烟
npm run test:smoke

# 本地 Docker 验证（从源码构建）
docker compose up -d --build
```

提交并推送到 `main`：

```bash
git add -A
git commit -m "描述本次改动"
git push origin main
```

### 2.  bump 版本并写发布说明

1. 修改根目录与 `client/package.json` 的 `"version"`（例如 `1.3.0` → `1.3.1`）  
2. 新增 `.github/release-notes/v1.3.1.md`（桌面 Release 正文会读这个文件）  
3. 提交版本号与 release notes  

### 3. 发布 Docker 镜像（给用户 `docker pull`）

**方式 A：打 tag，Actions 自动推 GHCR（推荐）**

```bash
git tag v1.3.1
git push origin v1.3.1
```

触发工作流：**Publish Docker Image**，产物：

- `ghcr.io/wann-99/noe-ssh:1.3.1`
- `ghcr.io/wann-99/noe-ssh:latest`

**方式 B：本机脚本推送**

```bash
echo <GITHUB_TOKEN> | docker login ghcr.io -u Wann-99 --password-stdin
./docker-publish.sh ghcr.io/wann-99/noe-ssh
# 可用 VERSION=1.3.1 指定标签；国内可改推阿里云等 registry
```

Package 需保持 **Public**，否则匿名用户拉不下来。

### 4. 发布桌面安装包（Releases）

打同一 tag 时会同时跑 **Release Desktop Packages**；也可在 Actions 里对 `main` 手动 **Run workflow**。

成功后到 https://github.com/Wann-99/noe-ssh/releases 下载（**不要保持 draft**，否则客户端自动更新发现不了）：

| 平台 | 典型文件 |
|------|----------|
| Windows | `Noe-SSH-*-Setup.exe` / Portable |
| macOS | `.dmg` / `.zip` |
| Linux | `.AppImage` / `.deb` / 便携 `.tar.gz` |

本地手动打包（可选）：

```bash
npm run prepare:build
npm run electron:build
npm run package:portable
# 产物在 dist/electron/ 、 dist/portable/
```

### 5. 用户侧如何升级（无需源码）

**Docker 用户**（`deploy/` 方式）：

```bash
cd noe-ssh   # 放 docker-compose.yml / .env / docker-start.sh 的目录
docker compose pull
./docker-start.sh
# .env 与 ./data 一般不用改
```

**桌面用户**：到 Releases 下载新安装包覆盖安装 / 解压运行即可。

### 发布检查清单

- [ ] `main` 已推送，本地/冒烟通过  
- [ ] 版本号与 `release-notes/vX.Y.Z.md` 已更新  
- [ ] tag `vX.Y.Z` 已推送（或已手动跑两个 workflow）  
- [ ] Actions：**Publish Docker Image** 成功  
- [ ] Actions：**Release Desktop Packages** 成功，Release 资源为安装包而非拆包目录  
- [ ] `docker pull ghcr.io/wann-99/noe-ssh:latest` 在目标网络可成功  

## 桌面 / 便携版

从 [Releases](https://github.com/Wann-99/noe-ssh/releases) 下载安装包，或见上一节本地构建命令。

### 自动更新

打包后的桌面应用会在启动约 8 秒后静默检查 GitHub Releases；也可在菜单 **帮助 → 检查更新…** 或托盘菜单手动检查。

| 形态 | 自动更新 |
|------|----------|
| **Linux AppImage** | 推荐，支持下载后重启安装 |
| Linux `.deb` / 便携 tar | 仅提示，建议改用 AppImage 或手动下新包 |
| Windows Setup | 可更新，未签名可能被 SmartScreen 拦截 |
| macOS | 可更新，未签名/未公证可能被系统拦截 |
| 便携 zip | 不适合原地覆盖，请手动下载 |

维护者发版时请确保 Release **已发布（非 draft）**，并包含对应平台的 `latest*.yml` 与安装包，自动更新才能发现新版本。

## 使用说明（摘要）

1. （可选）设置主密码创建凭据保险库  
2. 左侧填写主机信息；需要时展开「代理 / ProxyJump」  
3. 连接后使用右侧文件面板管理远程文件；双击文本文件会在中央编辑器打开
4. 顶部「+」新建会话标签，可并行连接多台主机  
5. 「已保存」中的凭据在解锁保险库后才能解密使用  

## 技术栈

- 后端：Node.js + Express + WebSocket + ssh2  
- 前端：React + TypeScript + Vite + xterm.js + CodeMirror 6 + Zustand
- 通信：WebSocket（终端 + 分块 SFTP）

## X11 转发（ssh -X）

1. 连接表单勾选「X11 转发」；需要完整信任时再勾选「信任 X11」（`-Y`）
2. **运行 Noe-SSH 的机器**需有图形会话（`echo $DISPLAY` 有值，或存在 `/tmp/.X11-unix/X0`）
3. 远程 `/etc/ssh/sshd_config` 中 `X11Forwarding yes` 后重载 sshd
4. 连接后终端内 `echo $DISPLAY` 应有值；再运行 GUI 程序

说明：X11 画面出现在 Noe-SSH **服务端本机**，不是浏览器标签页。

Docker 已默认挂载 `/tmp/.X11-unix`，并传入 `DISPLAY` / `NOE_SSH_X11_DISPLAY`（缺省 `:0`）。推荐用启动脚本（会自动探测显示器并执行 `xhost +local:`）：

```bash
./docker-start.sh          # 源码构建
# 或 deploy 目录：
./docker-start.sh
```

无头服务器没有 DISPLAY 时会跳过 X11，不影响 Web SSH。仅在本机显示器不是 `:0` 且自动探测失败时，才在 `.env` 里设置 `NOE_SSH_X11_DISPLAY`。

## 注意事项

- 明文凭据不会写入服务端磁盘；仅存在于连接过程的内存中  
- 大文件请使用流式传输（默认路径）；在线编辑限制 1MB
- macOS 未签名应用需在「隐私与安全性」中允许运行；X11 需安装并启动 XQuartz  

