# 云协同后端

secure 版本的云协同后端，使用 Go + SQLite，监听 `127.0.0.1:8788`。前端、API 和 WebSocket 通过 Caddy 同域部署。

## 本地开发

需要 Go（版本见 [go.mod](go.mod)）、Node.js 24 和 pnpm。在 `server/` 目录运行：

```powershell
$env:MOMO_PUBLIC_ORIGIN = 'http://localhost:5173'
$env:MOMO_SESSION_KEY = '<至少 32 字节的随机密钥>'
$env:MOMO_ADMIN_TOKEN = '<至少 24 字节的独立随机令牌>'
$env:MOMO_PASSWORDS = '["本机测试口令"]'
go run ./cmd/momo-server serve
```

仓库根目录的 `.env.local` 设置 `VITE_ENABLE_SECURE_MODE=true`，另开终端运行 `pnpm dev`，访问 `http://localhost:5173`。访问地址须与 `MOMO_PUBLIC_ORIGIN` 一致；Vite 已代理 API 和 WebSocket。

数据库默认位于启动目录下的 `data/momo.sqlite`。

## 部署与更新

后端单进程运行，公网使用 HTTPS。

1. 在开发机或 CI 的 `server/` 目录编译 Linux 二进制：

   ```powershell
   $env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
   go build -trimpath -o bin/momo-server ./cmd/momo-server
   ```

   ARM 服务器改用 `GOARCH=arm64`。

2. 创建 `momo` 系统用户，将二进制放到 `/opt/buildingmomo/momo-server`。参考 [环境变量模板](deploy/server.env.example) 创建 `/etc/buildingmomo/server.env`，填写域名、口令和密钥，仅限 root 读取，不提交到 Git。
3. 安装 [systemd 服务](deploy/momo-server.service)，数据库位于 `/var/lib/buildingmomo/momo.sqlite`。
4. 合并 [Caddy 配置](deploy/Caddyfile)，替换域名和静态目录。数据库、备份和环境文件不得放入静态目录。执行 `caddy validate --config /etc/caddy/Caddyfile` 后 reload。

启动并检查：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now momo-server
curl --fail http://127.0.0.1:8788/healthz
```

更新后端：先备份数据库，再停止服务、替换二进制并启动，保留旧版以便回退。修改 systemd 配置后需执行 `systemctl daemon-reload`。

### 上传前端

在开发机的仓库根目录，将 [.env.example](../.env.example) 中的 `MOMO_UPLOAD_HOST` 和 `MOMO_UPLOAD_DIR` 填入 `.env.local`，然后运行：

```powershell
pnpm build                   # VITE_ENABLE_SECURE_MODE=true 时清理 SEO
pnpm upload:server --dry-run  # 仅预览变化
pnpm upload:server            # 预览后输入 y 确认上传
```

Windows 使用 WSL Debian 的 rsync 和 SSH，服务器也需安装 rsync，并提前配置 SSH 登录。上传先资源后入口，不删除旧文件、不构建、不重启服务。

## 备份与恢复

```sh
cd /opt/buildingmomo
./momo-server list -db /var/lib/buildingmomo/momo.sqlite
./momo-server backup -db /var/lib/buildingmomo/momo.sqlite -file /备份目录/momo-日期.sqlite
./momo-server export -db /var/lib/buildingmomo/momo.sqlite -file /备份目录/momo-日期.jsonl
```

使用 `backup` 备份运行中的数据库，不要直接复制单个 `.sqlite` 文件；输出路径必须尚不存在。

自动备份：创建 `/var/lib/buildingmomo/backups` 并允许 `momo` 写入，安装 [备份服务](deploy/momo-backup.service) 和 [每日定时器](deploy/momo-backup.timer)，执行 `systemctl enable --now momo-backup.timer`。建议另存一份异机备份。

恢复步骤：

1. 停止服务，保留故障数据库及其 WAL/SHM 文件。
2. 将备份放入新的数据目录，允许 `momo` 访问，更新服务的 `-db`、`ReadWritePaths` 和备份任务路径；不要与旧 WAL 混用。
3. 执行 `systemctl daemon-reload` 后启动，检查房间、登录和协作。
