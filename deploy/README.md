# Noe-SSH Docker 部署（无需源码）

只需设置访问口令，其余使用默认值。

## 首次安装

```bash
# 下载本目录文件，例如：
curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/.env.example -o .env

# 编辑 .env，填写 NOE_SSH_ACCESS_TOKEN（长随机串）
docker compose up -d
```

浏览器打开 http://localhost:3000 ，输入口令即可。

## 升级到最新镜像

口令与端口配置（`.env`）一般不用改：

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
