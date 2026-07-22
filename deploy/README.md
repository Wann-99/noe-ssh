# Noe-SSH Docker 部署（无需源码）

推荐使用账号模式：设置管理员密码，数据落在 `./data`（SQLite）。

## 首次安装

```bash
curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/.env.example -o .env

# 编辑 .env，填写 NOE_SSH_ADMIN_PASSWORD（强密码）
docker compose up -d
```

浏览器打开 http://localhost:3000 ，用管理员账号登录。可在「管理后台」创建用户并查看审计。

遗留单口令：不设管理员密码时，可改用 `NOE_SSH_ACCESS_TOKEN`。

## 升级到最新镜像

账号、口令与数据卷（`.env` / `./data`）一般不用改：

```bash
docker compose pull
docker compose up -d
```

## 常用命令

```bash
docker compose logs -f   # 日志
docker compose down      # 停止
docker compose ps        # 状态
```

镜像地址：`ghcr.io/wann-99/noe-ssh:latest`（维护者发版后会更新）。  
若 `docker pull` 出现 DNS / 连接超时，多半是访问 `ghcr.io` 的网络问题，可稍后重试或使用代理。
