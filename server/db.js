// SQLite 持久化层：表结构、种子数据、通用读写
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, createReadStream, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedApis, seedGroups, seedApps, seedRules, seedAlerts, seedMetricsRows } from './seed.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'data.db')

mkdirSync(__dirname, { recursive: true })

export const db = new DatabaseSync(DB_PATH)
// WAL 模式：读写不互斥，降低并发调用下的锁等待；synchronous=NORMAL 在 WAL 下兼顾性能与持久性
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA synchronous = NORMAL')

db.exec(`
CREATE TABLE IF NOT EXISTS apis    (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS groups_ (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS apps    (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rules   (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alerts  (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS metrics (
  api_id TEXT NOT NULL,
  date   TEXT NOT NULL,
  calls  INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  latency_sum INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_id, date)
);
CREATE TABLE IF NOT EXISTS logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,
  api_id   TEXT,
  api_name TEXT,
  app_name TEXT,
  method   TEXT NOT NULL,
  path     TEXT NOT NULL,
  status   INTEGER NOT NULL,
  latency  INTEGER NOT NULL DEFAULT 0,
  ip       TEXT,
  message  TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts);
CREATE INDEX IF NOT EXISTS idx_logs_api ON logs (api_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,
  username TEXT NOT NULL,
  role     TEXT,
  action   TEXT NOT NULL,
  target   TEXT,
  detail   TEXT,
  ip       TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs (ts);
`)

const upsertStmt = {
  apis: db.prepare('INSERT INTO apis (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data'),
  groups: db.prepare('INSERT INTO groups_ (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data'),
  apps: db.prepare('INSERT INTO apps (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data'),
  rules: db.prepare('INSERT INTO rules (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data'),
  alerts: db.prepare('INSERT INTO alerts (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data'),
}

const listStmt = {
  apis: db.prepare('SELECT data FROM apis'),
  groups: db.prepare('SELECT data FROM groups_'),
  apps: db.prepare('SELECT data FROM apps'),
  rules: db.prepare('SELECT data FROM rules'),
  alerts: db.prepare('SELECT data FROM alerts'),
}

const delStmt = {
  apis: db.prepare('DELETE FROM apis WHERE id = ?'),
  groups: db.prepare('DELETE FROM groups_ WHERE id = ?'),
  apps: db.prepare('DELETE FROM apps WHERE id = ?'),
  rules: db.prepare('DELETE FROM rules WHERE id = ?'),
  alerts: db.prepare('DELETE FROM alerts WHERE id = ?'),
}

export const store = {
  upsert: (kind, obj) => upsertStmt[kind].run(obj.id, JSON.stringify(obj)),
  list: (kind) => listStmt[kind].all().map((r) => JSON.parse(r.data)),
  remove: (kind, id) => delStmt[kind].run(id),
  get: (kind, id) => store.list(kind).find((x) => x.id === id),
}

/** 记录一次网关调用 */
export function recordMetric(apiId, ok, latencyMs) {
  metricQueue.push({ apiId, ok: ok ? 1 : 0, latencyMs: Math.round(latencyMs) })
}

const metricInsertStmt = db.prepare(`
  INSERT INTO metrics (api_id, date, calls, errors, latency_sum)
  VALUES (?, ?, 1, ?, ?)
  ON CONFLICT(api_id, date) DO UPDATE SET
    calls = calls + 1,
    errors = errors + excluded.errors,
    latency_sum = latency_sum + excluded.latency_sum
`)

const MAX_LOGS = 20000

/** 记录一条调用日志（含被网关拒绝的请求）：进入异步队列，批量落库 */
export function addLog(entry) {
  logQueue.push({
    ts: new Date().toISOString().replace('T', ' ').slice(0, 19),
    apiId: entry.apiId ?? null, apiName: entry.apiName ?? null, appName: entry.appName ?? null,
    method: entry.method, path: entry.path, status: entry.status,
    latency: Math.round(entry.latency ?? 0), ip: entry.ip ?? null, message: entry.message ?? null,
  })
}

/* ---------- 数据面写库异步化 ----------
 * 网关每请求的指标/日志写入是同步 SQLite 操作，会阻塞事件循环上的其他请求。
 * 这里改为内存队列 + 每 250ms 事务批量落库；读路径（query*）开头先 flush，
 * 保证"写完即可读"（read-your-writes），看板与告警评估不受影响。 */
const metricQueue = []
const logQueue = []
const logInsertStmt = db.prepare(
  'INSERT INTO logs (ts, api_id, api_name, app_name, method, path, status, latency, ip, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
)

export function flushWrites() {
  if (metricQueue.length === 0 && logQueue.length === 0) return
  const metrics = metricQueue.splice(0)
  const logs = logQueue.splice(0)
  db.exec('BEGIN')
  try {
    const date = new Date().toISOString().slice(0, 10)
    for (const m of metrics) metricInsertStmt.run(m.apiId, date, m.ok ? 0 : 1, m.latencyMs)
    for (const l of logs) logInsertStmt.run(l.ts, l.apiId, l.apiName, l.appName, l.method, l.path, l.status, l.latency, l.ip, l.message)
    // 容量修剪放在批量事务内，每次 flush 至多检查一次
    if (logs.length > 0) {
      const count = db.prepare('SELECT COUNT(*) c FROM logs').get().c
      if (count > MAX_LOGS) {
        db.prepare('DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY id ASC LIMIT ?)').run(count - MAX_LOGS)
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[db] 批量写库失败:', err?.message ?? err)
  }
}

// 定时批量落库（250ms）；进程退出前兜底 flush，避免停服丢失最后一段日志
setInterval(flushWrites, 250).unref()
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { flushWrites(); process.exit(0) })
}

const MAX_AUDIT_LOGS = 50000

/** 记录一条管理操作审计日志，超容量时修剪最旧记录 */
export function addAudit({ username, role, action, target, detail, ip }) {
  db.prepare(
    'INSERT INTO audit_logs (ts, username, role, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    new Date().toISOString().replace('T', ' ').slice(0, 19),
    username, role ?? null, action, target ?? null, detail ?? null, ip ?? null,
  )
  const count = db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c
  if (count > MAX_AUDIT_LOGS) {
    db.prepare('DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs ORDER BY id ASC LIMIT ?)').run(count - MAX_AUDIT_LOGS)
  }
}

/** 分页查询审计日志 */
export function queryAudit({ username, keyword, page = 1, pageSize = 20 }) {
  const where = []
  const args = []
  if (username) { where.push('username = ?'); args.push(username) }
  if (keyword) { where.push('(action LIKE ? OR target LIKE ? OR detail LIKE ?)'); args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`) }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs ${whereSql}`).get(...args).c
  const items = db.prepare(
    `SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).all(...args, pageSize, (page - 1) * pageSize)
  return { total, page, pageSize, items }
}

/** 分页查询调用日志 */
export function queryLogs({ apiId, statusClass, appName, keyword, page = 1, pageSize = 20 }) {
  flushWrites() // 先落库队列中的新日志，保证读到自己刚写的数据
  const where = []
  const args = []
  if (apiId) { where.push('api_id = ?'); args.push(apiId) }
  if (statusClass === '2xx') where.push('status >= 200 AND status < 300')
  if (statusClass === '4xx') where.push('status >= 400 AND status < 500')
  if (statusClass === '5xx') where.push('status >= 500')
  if (appName) { where.push('app_name = ?'); args.push(appName) }
  if (keyword) { where.push('(path LIKE ? OR message LIKE ? OR api_name LIKE ?)'); args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`) }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) c FROM logs ${whereSql}`).get(...args).c
  const items = db.prepare(
    `SELECT * FROM logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).all(...args, pageSize, (page - 1) * pageSize)
  return { total, page, pageSize, items }
}

/** 近 N 分钟分钟级流量聚合（基于日志表，含被拒绝请求；返回 UTC 分钟串，前端转本地时区） */
export function queryMinuteMetrics(minutes = 60, apiId) {
  flushWrites()
  const since = new Date(Date.now() - minutes * 60000).toISOString().replace('T', ' ').slice(0, 16)
  const whereApi = apiId ? 'AND api_id = ?' : ''
  const args = apiId ? [since, apiId] : [since]
  const rows = db.prepare(`
    SELECT substr(ts, 1, 16) m,
           COUNT(*) calls,
           SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) errors,
           SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) rejected,
           ROUND(AVG(latency)) lat
    FROM logs WHERE ts >= ? ${whereApi}
    GROUP BY m ORDER BY m
  `).all(...args)
  const byMinute = new Map(rows.map((r) => [r.m, r]))

  // 补齐无流量的分钟，保证曲线连续
  const out = []
  const now = Date.now()
  for (let i = minutes - 1; i >= 0; i--) {
    const d = new Date(now - i * 60000)
    const key = d.toISOString().replace('T', ' ').slice(0, 16)
    const r = byMinute.get(key)
    out.push({
      minute: key,
      calls: r ? Number(r.calls) : 0,
      errors: r ? Number(r.errors) : 0,
      rejected: r ? Number(r.rejected) : 0,
      avgLatency: r ? Number(r.lat) : 0,
    })
  }
  return out
}

/** 查询指标：apiId 为空时汇总所有已发布 API */
export function queryMetrics(apiId, days = 30) {
  flushWrites()
  const since = new Date()
  since.setDate(since.getDate() - (days - 1))
  const sinceStr = since.toISOString().slice(0, 10)

  let rows
  if (apiId) {
    rows = db.prepare(
      'SELECT date, SUM(calls) calls, SUM(errors) errors, SUM(latency_sum) lat FROM metrics WHERE api_id = ? AND date >= ? GROUP BY date ORDER BY date',
    ).all(apiId, sinceStr)
  } else {
    rows = db.prepare(`
      SELECT m.date, SUM(m.calls) calls, SUM(m.errors) errors, SUM(m.latency_sum) lat
      FROM metrics m JOIN apis a ON a.id = m.api_id
      WHERE m.date >= ? AND json_extract(a.data, '$.status') = 'published'
      GROUP BY m.date ORDER BY m.date
    `).all(sinceStr)
  }
  const byDate = new Map(rows.map((r) => [r.date, r]))

  // 补齐无数据的日期，保证图表连续
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const r = byDate.get(key)
    out.push({
      date: key,
      calls: r ? Number(r.calls) : 0,
      errors: r ? Number(r.errors) : 0,
      avgLatency: r && Number(r.calls) > 0 ? Math.round(Number(r.lat) / Number(r.calls)) : 0,
    })
  }
  return out
}

/** 每个 API 的今日调用量与近 30 天总量（列表/看板用） */
export function apiCallStats() {
  flushWrites()
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date()
  since.setDate(since.getDate() - 29)
  const rows = db.prepare(`
    SELECT api_id,
           SUM(CASE WHEN date = ? THEN calls ELSE 0 END) today,
           SUM(calls) total30d
    FROM metrics WHERE date >= ? GROUP BY api_id
  `).all(today, since.toISOString().slice(0, 10))
  return new Map(rows.map((r) => [r.api_id, { todayCalls: Number(r.today), calls30d: Number(r.total30d) }]))
}

function clearAll() {
  db.exec('DELETE FROM apis; DELETE FROM groups_; DELETE FROM apps; DELETE FROM rules; DELETE FROM alerts; DELETE FROM metrics; DELETE FROM logs;')
}

export function seedAll() {
  clearAll()
  const apis = seedApis()
  for (const a of apis) store.upsert('apis', a)
  for (const g of seedGroups()) store.upsert('groups', g)
  for (const a of seedApps(apis)) store.upsert('apps', a)
  for (const r of seedRules()) store.upsert('rules', r)
  for (const r of seedAlerts()) store.upsert('alerts', r)
  const ins = db.prepare('INSERT OR REPLACE INTO metrics (api_id, date, calls, errors, latency_sum) VALUES (?, ?, ?, ?, ?)')
  for (const m of seedMetricsRows(apis)) ins.run(m.apiId, m.date, m.calls, m.errors, m.latencySum)
}

/** 业务数据表清单（恢复时按此顺序整体替换） */
const BUSINESS_TABLES = ['apis', 'groups_', 'apps', 'rules', 'alerts', 'metrics', 'logs', 'audit_logs']

/** 生成一致性备份文件（VACUUM INTO），返回临时文件路径，调用方流式发送后需自行删除 */
export function createBackup() {
  flushWrites() // 先落库队列中的日志/指标，保证备份快照包含最新数据
  const tmpPath = join(__dirname, `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`)
  // VACUUM INTO 不支持绑定参数，路径为本函数内部生成，转义后内联
  db.exec(`VACUUM INTO '${tmpPath.replaceAll("'", "''")}'`)
  return tmpPath
}

/**
 * 从上传的 SQLite 文件恢复数据：校验文件头后 ATTACH 导入，事务内整体替换业务表；
 * includeUsers 为 true 时连同用户账号一并恢复（调用方需随后注销全部会话）。
 * 恢复完成后会追加一条审计记录（此时审计表已被替换为备份内容）。
 */
export function restoreFrom(fileBuf, { includeUsers = false } = {}) {
  const MAGIC = 'SQLite format 3'
  if (fileBuf.length < 100 || fileBuf.subarray(0, MAGIC.length).toString('latin1') !== MAGIC) {
    return { ok: false, message: '文件不是有效的 SQLite 数据库' }
  }
  const tmpPath = join(__dirname, `restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`)
  writeFileSync(tmpPath, fileBuf)
  try {
    db.prepare(`ATTACH DATABASE ? AS bak`).run(tmpPath)
    try {
      // 校验备份文件包含核心表
      const bakTables = db.prepare(`SELECT name FROM bak.sqlite_master WHERE type='table'`).all().map((r) => r.name)
      const missing = BUSINESS_TABLES.filter((t) => !bakTables.includes(t))
      if (missing.length > 0) return { ok: false, message: `备份文件缺少数据表：${missing.join('、')}` }

      const tables = includeUsers ? [...BUSINESS_TABLES, 'users'] : BUSINESS_TABLES
      db.exec('BEGIN')
      try {
        for (const t of tables) {
          db.exec(`DELETE FROM main.${t}`)
          db.exec(`INSERT INTO main.${t} SELECT * FROM bak.${t}`)
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      return { ok: true, tables: tables.length }
    } finally {
      db.exec('DETACH DATABASE bak')
    }
  } catch (err) {
    return { ok: false, message: '恢复失败：' + (err?.message ?? 'unknown') }
  } finally {
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

export function backupStream(filePath) {
  return createReadStream(filePath)
}

export function fileSize(filePath) {
  return statSync(filePath).size
}

export function removeFile(filePath) {
  try { unlinkSync(filePath) } catch { /* ignore */ }
}

// 首次启动自动灌入示例数据
if (store.list('apis').length === 0) {
  seedAll()
  console.log('[db] 已初始化示例数据')
}
