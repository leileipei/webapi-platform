#!/usr/bin/env bash
# WebAPI 管理平台 —— 首次部署脚本（Linux / macOS）
#
# 用法：
#   bash scripts/deploy.sh                      # 默认安装到 /opt/webapi-platform，端口 3100
#   INSTALL_DIR=/data/webapi PORT=8080 bash scripts/deploy.sh
#
# 可配置环境变量：
#   INSTALL_DIR  安装目录（默认 /opt/webapi-platform）
#   PORT         监听端口（默认 3100）
#   HOST         监听地址（默认 0.0.0.0，全网卡可访问）
#   LOG_RETENTION_DAYS  日志保留天数（默认 30）
#
# 部署内容：代码 + 启动/停止脚本（bin/start.sh、bin/stop.sh）+ 配置文件（deploy.env）。
# 数据（SQLite 库 server/data.db、归档 server/archives/）在首次启动时自动初始化，之后升级不丢数据。
set -euo pipefail

INSTALL_DIR=${INSTALL_DIR:-/opt/webapi-platform}
PORT=${PORT:-3100}
HOST=${HOST:-0.0.0.0}
LOG_RETENTION_DAYS=${LOG_RETENTION_DAYS:-30}

# 脚本位于 <项目根>/scripts/deploy.sh，源码根目录取其上一级
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 1/5 环境检查"
if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 node，请先安装 Node.js >= 22.5（推荐 24 LTS）" >&2
  exit 1
fi
NODE_VER=$(node -e "console.log(process.versions.node)")
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<5)) process.exit(1)" \
  || { echo "错误：Node.js $NODE_VER 版本过低，需要 >= 22.5（内置 node:sqlite 模块）" >&2; exit 1; }
node -e "import('node:sqlite').then(()=>{}).catch(()=>process.exit(1))" \
  || { echo "错误：当前 Node.js 不包含 node:sqlite 模块" >&2; exit 1; }
echo "    Node.js $NODE_VER ✓"

echo "==> 2/5 复制代码到 $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# 排除运行时数据与依赖目录：数据绝不在部署/升级时被覆盖。
# 注意 server 只复制 .js 源码，绝不能带入源目录里的 data.db / archives / run.log
for item in src public scripts dist docs package.json package-lock.json index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json tailwind.config.js postcss.config.js components.json README.md; do
  [ -e "$SOURCE_DIR/$item" ] && cp -r "$SOURCE_DIR/$item" "$INSTALL_DIR/"
done
mkdir -p "$INSTALL_DIR/server/archives"
cp "$SOURCE_DIR"/server/*.js "$INSTALL_DIR/server/"

if [ ! -f "$INSTALL_DIR/dist/index.html" ]; then
  echo "    未发现前端构建产物 dist/，执行 npm ci && npm run build ..."
  (cd "$INSTALL_DIR" && npm ci && npm run build)
fi

echo "==> 3/5 生成配置 deploy.env 与启动脚本"
cat > "$INSTALL_DIR/deploy.env" <<EOF
# WebAPI 管理平台运行配置（bin/start.sh 启动时加载）
PORT=$PORT
HOST=$HOST
LOG_RETENTION_DAYS=$LOG_RETENTION_DAYS
# 公网反代（Nginx/Caddy 终结 HTTPS）时开启：TRUST_PROXY=1
# 管理接口跨域白名单（逗号分隔）：CORS_ORIGIN=https://a.com,https://b.com
# 切勿在生产开启 ALLOW_LOCAL_TEST（仅供本机 e2e 测试）
EOF

mkdir -p "$INSTALL_DIR/bin"
cat > "$INSTALL_DIR/bin/start.sh" <<'EOF'
#!/usr/bin/env bash
# 启动 WebAPI 管理平台（后台运行，日志 server/run.log，PID server/server.pid）
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f deploy.env ] && . ./deploy.env; set +a
if [ -f server/server.pid ] && kill -0 "$(cat server/server.pid)" 2>/dev/null; then
  echo "服务已在运行（PID $(cat server/server.pid)）"; exit 0
fi
nohup node server/index.js >> server/run.log 2>&1 &
echo $! > server/server.pid
echo "已启动，PID $(cat server/server.pid)，端口 ${PORT:-3100}"
EOF
cat > "$INSTALL_DIR/bin/stop.sh" <<'EOF'
#!/usr/bin/env bash
# 停止 WebAPI 管理平台
cd "$(dirname "$0")/.."
if [ -f server/server.pid ] && kill -0 "$(cat server/server.pid)" 2>/dev/null; then
  kill "$(cat server/server.pid)"
  for i in $(seq 1 20); do kill -0 "$(cat server/server.pid)" 2>/dev/null || break; sleep 0.3; done
  rm -f server/server.pid
  echo "已停止"
else
  echo "服务未在运行"
fi
EOF
chmod +x "$INSTALL_DIR/bin/start.sh" "$INSTALL_DIR/bin/stop.sh"

echo "==> 4/5 启动服务"
"$INSTALL_DIR/bin/start.sh"

echo "==> 5/5 健康检查"
ok=0
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 0.5
done
if [ "$ok" != "1" ]; then
  echo "错误：健康检查未通过，请查看日志 $INSTALL_DIR/server/run.log" >&2
  exit 1
fi

LOCAL_IP=$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true) | awk '{print $1}'); LOCAL_IP=${LOCAL_IP:-<服务器IP>}
cat <<EOF

✅ 部署完成，服务已启动

  本机访问：http://localhost:$PORT
  局域网访问：http://$LOCAL_IP:$PORT

  默认管理员：admin / Admin@123
  ⚠️  首次登录会被强制修改密码，请立即完成修改。

  数据位置：$INSTALL_DIR/server/data.db（SQLite，含全部业务数据）
  归档目录：$INSTALL_DIR/server/archives/
  运行日志：$INSTALL_DIR/server/run.log
  配置文件：$INSTALL_DIR/deploy.env（改后执行 bin/stop.sh && bin/start.sh 生效）

  日常运维：
    停止：$INSTALL_DIR/bin/stop.sh
    启动：$INSTALL_DIR/bin/start.sh
    升级：bash scripts/upgrade.sh --from <新版本代码目录>
EOF
