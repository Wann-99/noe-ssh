# Noe-SSH Docker 部署（无需源码）

只需设置访问口令，其余使用默认值。

```bash
# 下载本目录任意方式均可，例如：
# curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/docker-compose.yml -o docker-compose.yml
# curl -fsSL https://raw.githubusercontent.com/Wann-99/noe-ssh/main/deploy/.env.example -o .env

cp .env.example .env
# 编辑 .env，填写 NOE_SSH_ACCESS_TOKEN（长随机串）

docker compose up -d
```

浏览器打开 http://localhost:3000 ，输入口令即可。

```bash
docker compose logs -f   # 日志
docker compose down      # 停止
docker compose pull && docker compose up -d   # 升级到最新镜像
```
