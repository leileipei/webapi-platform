#!/usr/bin/env bash
# WebAPI 管理平台 —— 一键升级脚本（含数据备份与失败自动回滚）
#
# 用法：
#   bash scripts/upgrade.sh --from /tmp/webapi-platform-1.4.4     # 用新版本代码目录升级（推荐）
#   bash scripts/upgrade.sh                                       # 安装目录是 git 仓库时，拉取最新 main 升级
#   INSTALL_DIR=/data/webapi bash scripts/upgrade.sh --from ...
#
# 流程：健康检查 → 停服 → 备份数据与代码 → 更新代码 → （必要时构建前端）→ 启服 →
#       健康检查；任一环节失败自动回滚到升级前的代码与数据。
# 数据安全：SQLite 库与归档目录只在备份/回滚时被动复制，升级过程绝不修改业务数据；
#           数据结构变更由服务启动时自动迁移（向后兼容）。
set -euo pipefail

INSTALL_DIR=${INSTALL_DIR:-/opt/webapi-platform}
FROM=""
KEEP_BACKUPS=5

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --keep) KEEP_BACKUPS="$2"; shift 2 ;;
    *) echo "未知参数：$1（支持 --from <目录> / --keep <份数>）" >&2; exit 1 ;;
  esac
done

cd "$INSTALL_DIR"
[ -f bin/start.sh ] || { echo "错误：$INSTALL_DIR 不是有效的安装目录（缺少 bin/start.sh），请先用 deploy.sh 部署" >&2; exit 1; }
set -a; [ -f deploy.env ] && . ./deploy.env; set +a
PORT=${PORT:-3100}
TS=$(date +%Y%m%d-%H%M%S)
BK_DIR="backups/$TS"
OLD_VER=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo unknown)

health() { curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; }

rollback() {
  echo "!!! 升级失败，开始回滚到 v$OLD_VER ..."
  bin/stop.sh >/dev/null 2>&1 || true
  [ -f "$BK_DIR/code.tar.gz" ] && tar xzf "$BK_DIR/code.tar.gz"
  [ -f "$BK_DIR/data.tar.gz" ] && tar xzf "$BK_DIR/data.tar.gz"
  bin/start.sh >/dev/null 2>&1 || true
  for i in $(seq 1 30); do health && break; sleep 0.5; done
  if health; then
    echo "!!! 已回滚到 v$OLD_VER，服务恢复运行。失败原因请查看 server/run.log 与上面的输出。"
  else
    echo "!!! 回滚后健康检查仍未通过，请人工介入：日志 server/run.log，备份 $BK_DIR" >&2
  fi
  exit 1
}

echo "==> 升级前检查（当前版本 v$OLD_VER）"
health || { echo "错误：服务当前不可用，请先排查或重启（bin/stop.sh && bin/start.sh）后再升级" >&2; exit 1; }
if [ -n "$FROM" ]; then
  [ -f "$FROM/server/index.js" ] || { echo "错误：--from 目录 $FROM 不含 server/index.js，不是有效的代码包" >&2; exit 1; }
  NEW_VER=$(node -e "console.log(require('$FROM/package.json').version)" 2>/dev/null || echo unknown)
else
  [ -d .git ] || { echo "错误：安装目录不是 git 仓库，请使用 --from <新版本代码目录>" >&2; exit 1; }
  NEW_VER="git-latest"
fi
echo "    目标版本：v$NEW_VER"

echo "==> 1/4 停服并备份数据与代码 → $BK_DIR"
bin/stop.sh
mkdir -p "$BK_DIR/code"
# 停服后 WAL 已 checkpoint，直接打包库文件与归档目录即可保证一致性
tar czf "$BK_DIR/data.tar.gz" server/data.db* server/archives 2>/dev/null \
  || { echo "警告：未找到既有数据（可能为首次启动前升级），跳过数据备份"; }
# 旧代码整体打包（tar 保留目录结构，回滚直接解包即可），不含运行时数据
tar czf "$BK_DIR/code.tar.gz" server/*.js scripts dist docs package.json package-lock.json bin deploy.env 2>/dev/null
echo "    备份完成：data.tar.gz（数据）+ code.tar.gz（旧代码 v$OLD_VER）"

echo "==> 2/4 更新代码到 v$NEW_VER"
if [ -n "$FROM" ]; then
  # server 只更新 .js 源码，绝不触碰 data.db / archives / run.log 等运行时数据
  for item in src public scripts dist docs package.json package-lock.json index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json tailwind.config.js postcss.config.js components.json README.md; do
    [ -e "$FROM/$item" ] && cp -r "$FROM/$item" ./
  done
  cp "$FROM"/server/*.js server/
else
  git pull --ff-only || rollback
fi
# 前端产物缺失时现场构建（源码包不含 dist 的情况）
if [ ! -f dist/index.html ]; then
  echo "    构建前端产物 ..."
  npm ci && npm run build || rollback
fi

echo "==> 3/4 启动服务（数据库结构如有变更将自动迁移，业务数据不受影响）"
bin/start.sh

echo "==> 4/4 升级后健康检查"
ok=0
for i in $(seq 1 40); do health && { ok=1; break; }; sleep 0.5; done
[ "$ok" = "1" ] || rollback

NOW_VER=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo unknown)
# 清理旧备份，仅保留最近 N 份
ls -dt backups/*/ 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs rm -rf 2>/dev/null || true

LOCAL_IP=$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true) | awk '{print $1}'); LOCAL_IP=${LOCAL_IP:-<服务器IP>}
cat <<EOF

✅ 升级完成：v$OLD_VER → v$NOW_VER

  访问地址：http://$LOCAL_IP:$PORT
  数据备份：$INSTALL_DIR/$BK_DIR（含 data.tar.gz 与 code.tar.gz，保留最近 $KEEP_BACKUPS 份）
  运行日志：$INSTALL_DIR/server/run.log

  如需人工回滚：bin/stop.sh && tar xzf $BK_DIR/data.tar.gz && tar xzf $BK_DIR/code.tar.gz && bin/start.sh
EOF
