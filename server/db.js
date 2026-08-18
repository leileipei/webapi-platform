// SQLite 持久化层：表结构、种子数据、通用读写
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedApis, seedGroups, seedApps, seedRules, seedAlerts, seedMetricsRows } from './seed.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'data.db')

mkdirSync(__dirname, { recursive: true })

export const db = new DatabaseSync(DB_PATH)

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
  const date = new Date().toISOString().slice(0, 10)
  db.prepare(`
    INSERT INTO metrics (api_id, date, calls, errors, latency_sum)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(api_id, date) DO UPDATE SET
      calls = calls + 1,
      errors = errors + excluded.errors,
      latency_sum = latency_sum + excluded.latency_sum
  `).run(apiId, date, ok ? 0 : 1, Math.round(latencyMs))
}

/** 查询指标：apiId 为空时汇总所有已发布 API */
export function queryMetrics(apiId, days = 30) {
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
  db.exec('DELETE FROM apis; DELETE FROM groups_; DELETE FROM apps; DELETE FROM rules; DELETE FROM alerts; DELETE FROM metrics;')
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

// 首次启动自动灌入示例数据
if (store.list('apis').length === 0) {
  seedAll()
  console.log('[db] 已初始化示例数据')
}
