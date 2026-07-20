# Noe-SSH —— 让 SSH 变得简单

## 一句话介绍

**Noe-SSH** 是一款基于 Web 的 SSH 可视化终端。支持多会话、跳板机、加密凭据与流式文件传输，桌面与 Docker 均可使用。

## 核心亮点

- 浏览器 / 桌面里的 xterm 终端
- 多标签并行 SSH
- 像管理本地文件一样管理远程文件（流式上传下载）
- GUI 操作自动生成可学习的命令
- 主密码加密保存连接凭据
- 一级 ProxyJump + HTTP/SOCKS5 代理
- 自托管可选访问口令

## 快速体验

```bash
npm install
npm run build:client
npm start
```

打开 http://localhost:3000 。
