// WebAPI 管理平台后端：管理 API + 真实网关转发 + 内置 mock 上游
// 零第三方依赖：node:http + node:sqlite
import http from 'node:http'
import { store, recordMetric, queryMetrics, apiCallStats, seedAll, addLog, queryLogs } from './db.js'
import { ensureAdmin, login, verify, logout, changePassword } from './auth.js'

ensureAdmin()

const PORT = process.env.PORT ? Number(process.env.PORT) : 3100

/* ---------- 运行时状态（内存） ---------- */
// 限流：apiId -> { sec, count }
const rateBuckets = new Map()
// 熔断：apiId -> [{ts, ok}]
const cbWindows = new Map()
// 熔断恢复：apiId -> 熔断截止时间戳
const cbOpenUntil = new Map()
// 健康度：apiId -> 最近 50 次结果 [{ts, ok, latency}]
const recentCalls = new Map()

function pushRecent(apiId, ok, latency) {
  const arr = recentCalls.get(apiId) ?? []
  arr.push({ ts: Date.now(), ok, latency })
  if (arr.length > 50) arr.shift()
  recentCalls.set(apiId, arr)

  const cb = cbWindows.get(apiId) ?? []
  cb.push({ ts: Date.now(), ok })
  const cutoff = Date.now() - 5 * 60 * 1000
  while (cb.length && cb[0].ts < cutoff) cb.shift()
  cbWindows.set(apiId, cb)
}

function computeHealth(apiId) {
  const arr = (recentCalls.get(apiId) ?? []).filter((r) => r.ts > Date.now() - 5 * 60 * 1000)
  if (arr.length === 0) return 'unknown'
  const errRate = arr.filter((r) => !r.ok).length / arr.length
  if (errRate >= 0.5) return 'down'
  if (errRate >= 0.05) return 'degraded'
  return 'healthy'
}

/* ---------- 工具 ---------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': '*',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(Buffer.alloc(0)))
  })
}

/** 把注册路径 /api/v1/users/{id} 编译成匹配器 */
function compilePath(path) {
  const names = []
  const pattern = path.replace(/[.*+?^${}()|[\]\\]/g, (m) => '\\' + m).replace(/\\\{(\w+)\\\}/g, (_, n) => {
    names.push(n)
    return '([^/]+)'
  })
  const re = new RegExp('^' + pattern + '$')
  return { re, names }
}

function matchApi(apis, method, reqPath) {
  for (const api of apis) {
    const { re, names } = compilePath(api.path)
    const m = re.exec(reqPath)
    if (m && api.method === method) {
      const params = {}
      names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])))
      return { api, params }
    }
  }
  // 路径命中但方法不符 → 405
  for (const api of apis) {
    if (compilePath(api.path).re.test(reqPath)) return { api: null, methodMismatch: true }
  }
  return null
}

function checkRateLimit(api) {
  const nowSec = Math.floor(Date.now() / 1000)
  const b = rateBuckets.get(api.id)
  if (!b || b.sec !== nowSec) {
    rateBuckets.set(api.id, { sec: nowSec, count: 1 })
    return true
  }
  if (b.count >= api.qps) return false
  b.count++
  return true
}

function checkCircuitBreaker(api) {
  if (!api.circuitBreaker?.enabled) return true
  const openUntil = cbOpenUntil.get(api.id)
  if (openUntil && openUntil > Date.now()) return false
  return true
}

function updateCircuitBreaker(api) {
  if (!api.circuitBreaker?.enabled) return
  const windowMs = (api.circuitBreaker.windowSec || 30) * 1000
  const cutoff = Date.now() - windowMs
  const cb = (cbWindows.get(api.id) ?? []).filter((r) => r.ts >= cutoff)
  if (cb.length < 10) return // 至少 10 个样本才判定
  const errRate = cb.filter((r) => !r.ok).length / cb.length
  if (errRate * 100 >= api.circuitBreaker.errorRateThreshold) {
    cbOpenUntil.set(api.id, Date.now() + windowMs)
  }
}

/** 告警评估：今日错误率 / 平均延迟 超阈值时生成告警（同规则同 API 当日去重） */
function evaluateAlerts(apiId) {
  const today = new Date().toISOString().slice(0, 10)
  const m = queryMetrics(apiId, 1)[0]
  if (!m || m.calls < 5) return
  const api = store.get('apis', apiId)
  if (!api) return
  const rules = store.list('rules').filter((r) => r.enabled)
  const existing = store.list('alerts')
  for (const rule of rules) {
    let hit = false
    let detail = ''
    if (rule.metric === 'errorRate') {
      const rate = (m.errors / m.calls) * 100
      if (rate > rule.threshold) {
        hit = true
        detail = `错误率 ${rate.toFixed(1)}%，阈值 ${rule.threshold}%`
      }
    } else if (rule.metric === 'latency') {
      if (m.avgLatency > rule.threshold) {
        hit = true
        detail = `平均延迟 ${m.avgLatency}ms，阈值 ${rule.threshold}ms`
      }
    } else if (rule.metric === 'qps') {
      if (m.calls > rule.threshold) {
        hit = true
        detail = `今日调用量 ${m.calls}，阈值 ${rule.threshold}`
      }
    }
    if (!hit) continue
    const dup = existing.some(
      (r) => r.ruleId === rule.id && r.apiId === apiId && r.time.startsWith(today),
    )
    if (dup) continue
    const record = {
      id: `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      apiId,
      apiName: api.name,
      level: rule.level,
      message: `「${api.name}」${detail}`,
      time: new Date().toISOString().replace('T', ' ').slice(0, 19),
      acked: 0,
    }
    store.upsert('alerts', record)
    console.log(`[alert] ${record.level} ${record.message}`)
  }
}

/* ---------- 网关转发 ---------- */
async function forward(api, params, req, body, url) {
  // 替换后端地址中的 {param} 占位符
  let target = api.backendUrl
  for (const [k, v] of Object.entries(params)) target = target.replaceAll(`{${k}}`, encodeURIComponent(v))
  if (url.search) target += url.search

  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    const key = k.toLowerCase()
    if (['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding'].includes(key)) continue
    headers[k] = v
  }
  if (body.length > 0 && !headers['content-type']) headers['content-type'] = 'application/json'

  let lastErr = null
  const attempts = 1 + (api.retry || 0)
  for (let i = 0; i < attempts; i++) {
    try {
      const upstream = await fetch(target, {
        method: api.method,
        headers,
        body: ['GET', 'HEAD'].includes(api.method) || body.length === 0 ? undefined : body,
        signal: AbortSignal.timeout(api.timeout || 3000),
        redirect: 'manual',
      })
      const respBody = Buffer.from(await upstream.arrayBuffer())
      if (upstream.status >= 500 && i < attempts - 1) continue // 5xx 触发重试
      return { status: upstream.status, body: respBody, contentType: upstream.headers.get('content-type') ?? 'application/json' }
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) continue
    }
  }
  throw lastErr
}

async function handleGateway(req, res, url) {
  const start = performance.now()
  const reqPath = decodeURIComponent(url.pathname.slice(3)) // 去掉 /gw 前缀
  const apis = store.list('apis')
  const matched = matchApi(apis, req.method, reqPath)

  // 审计日志：网关所有出入请求（含被拒绝的）都落库
  const log = { method: req.method, path: reqPath + (url.search || ''), ip: req.socket.remoteAddress }
  const writeLog = (status, extra = {}) =>
    addLog({ ...log, status, latency: performance.now() - start, ...extra })

  if (!matched) {
    writeLog(404, { message: '路由不存在' })
    return json(res, 404, { code: 40404, message: `网关未找到路由: ${req.method} ${reqPath}` })
  }
  if (matched.methodMismatch) {
    writeLog(405, { message: '请求方法不允许' })
    return json(res, 405, { code: 40500, message: '请求方法不允许' })
  }

  const { api, params } = matched
  log.apiId = api.id
  log.apiName = api.name

  // 生命周期检查
  if (api.status !== 'published') {
    writeLog(403, { message: `API 状态为 ${api.status}` })
    return json(res, 403, { code: 40301, message: `API「${api.name}」当前状态为 ${api.status}，不可调用` })
  }

  // 鉴权
  if (api.auth === 'apikey') {
    const ak = req.headers['x-access-key']
    const app = ak ? store.list('apps').find((a) => a.accessKey === ak) : null
    if (app) log.appName = app.name
    if (!app) {
      writeLog(401, { message: '缺少或无效的 AccessKey' })
      return json(res, 401, { code: 40100, message: '缺少或无效的 X-Access-Key' })
    }
    if (app.status !== 'active') {
      writeLog(401, { message: `应用「${app.name}」已停用` })
      return json(res, 401, { code: 40101, message: `应用「${app.name}」已被停用` })
    }
    if (!app.apiIds.includes(api.id)) {
      writeLog(403, { message: `应用「${app.name}」未授权` })
      return json(res, 403, { code: 40302, message: `应用「${app.name}」未被授权调用该 API` })
    }
  }

  // 限流
  if (!checkRateLimit(api)) {
    writeLog(429, { message: `QPS 超上限 ${api.qps}` })
    return json(res, 429, { code: 42900, message: `触发限流：QPS 上限 ${api.qps}` })
  }

  // 熔断
  if (!checkCircuitBreaker(api)) {
    writeLog(503, { message: '熔断开启' })
    return json(res, 503, { code: 50301, message: '熔断开启：后端错误率过高，请稍后重试' })
  }

  const body = await readBody(req)
  let ok = true
  try {
    const result = await forward(api, params, req, body, url)
    ok = result.status < 500
    const latency = performance.now() - start
    pushRecent(api.id, ok, latency)
    recordMetric(api.id, ok, latency)
    evaluateAlerts(api.id)
    updateCircuitBreaker(api)
    writeLog(result.status, ok ? {} : { message: `上游返回 ${result.status}` })
    res.writeHead(result.status, {
      'Content-Type': result.contentType,
      'Access-Control-Allow-Origin': '*',
      'X-Gateway-Latency': String(Math.round(latency)),
    })
    res.end(result.body)
  } catch (err) {
    ok = false
    const latency = performance.now() - start
    pushRecent(api.id, ok, latency)
    recordMetric(api.id, ok, latency)
    evaluateAlerts(api.id)
    updateCircuitBreaker(api)
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    writeLog(isTimeout ? 504 : 502, { message: isTimeout ? '后端超时' : `后端不可达 ${err?.cause?.code ?? ''}` })
    json(res, isTimeout ? 504 : 502, {
      code: isTimeout ? 50400 : 50200,
      message: isTimeout ? `后端超时（>${api.timeout}ms）` : `后端不可达：${err?.cause?.code ?? err?.message ?? 'unknown'}`,
    })
  }
}

/* ---------- 内置 mock 上游 ---------- */
async function handleUpstream(req, res, url) {
  const body = await readBody(req)
  const fail = url.searchParams.get('__fail')
  const delayMs = Math.min(Number(url.searchParams.get('__delay') ?? 0), 10000)
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  if (fail) {
    return json(res, Number(fail) || 500, { code: 50000, message: '上游模拟故障（__fail 参数触发）' })
  }
  json(res, 200, {
    code: 0,
    message: 'success',
    data: {
      echo: {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: body.length > 0 ? body.toString('utf-8').slice(0, 500) : null,
      },
      timestamp: new Date().toISOString(),
      serverTime: Date.now(),
    },
  })
}

/* ---------- 管理 API ---------- */
function fullState() {
  const stats = apiCallStats()
  const apis = store.list('apis').map((a) => ({
    ...a,
    health: computeHealth(a.id) === 'unknown' ? (a.status === 'published' ? 'healthy' : 'unknown') : computeHealth(a.id),
    ...(stats.get(a.id) ?? { todayCalls: 0, calls30d: 0 }),
  }))
  return {
    apis,
    groups: store.list('groups'),
    apps: store.list('apps'),
    alertRules: store.list('rules'),
    alertRecords: store.list('alerts').sort((a, b) => (a.time < b.time ? 1 : -1)),
  }
}

async function handleAdmin(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean) // ['admin', ...]
  const resource = parts[1]
  const id = parts[2] ? decodeURIComponent(parts[2]) : null
  const sub = parts[3]

  try {
    // ---- 认证接口（登录公开，其余需会话） ----
    if (resource === 'auth') {
      if (id === 'login' && req.method === 'POST') {
        const { username, password } = JSON.parse((await readBody(req)).toString('utf-8') || '{}')
        if (!username || !password) return json(res, 400, { message: '请输入用户名和密码' })
        const result = login(String(username), String(password))
        if (!result) return json(res, 401, { message: '用户名或密码错误' })
        return json(res, 200, result)
      }
      const session = verify(req)
      if (!session) return json(res, 401, { message: '未登录或会话已过期' })
      if (id === 'me' && req.method === 'GET') return json(res, 200, { username: session.username })
      if (id === 'logout' && req.method === 'POST') {
        logout(session.token)
        return json(res, 200, { ok: true })
      }
      if (id === 'password' && req.method === 'POST') {
        const { oldPassword, newPassword } = JSON.parse((await readBody(req)).toString('utf-8') || '{}')
        const r = changePassword(session.username, String(oldPassword ?? ''), String(newPassword ?? ''))
        return json(res, r.ok ? 200 : 400, r)
      }
      return json(res, 404, { message: '未知认证接口' })
    }

    // ---- 其余管理接口一律要求登录 ----
    const session = verify(req)
    if (!session) return json(res, 401, { message: '未登录或会话已过期' })

    if (resource === 'state' && req.method === 'GET') return json(res, 200, fullState())

    if (resource === 'metrics' && req.method === 'GET') {
      const apiId = url.searchParams.get('apiId')
      const days = Math.min(Number(url.searchParams.get('days') ?? 30), 90)
      return json(res, 200, queryMetrics(apiId || null, days))
    }

    if (resource === 'logs' && req.method === 'GET') {
      return json(res, 200, queryLogs({
        apiId: url.searchParams.get('apiId') || undefined,
        statusClass: url.searchParams.get('statusClass') || undefined,
        appName: url.searchParams.get('appName') || undefined,
        keyword: url.searchParams.get('keyword') || undefined,
        page: Math.max(1, Number(url.searchParams.get('page') ?? 1)),
        pageSize: Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? 20))),
      }))
    }

    if (resource === 'reset' && req.method === 'POST') {
      seedAll()
      recentCalls.clear()
      cbWindows.clear()
      cbOpenUntil.clear()
      rateBuckets.clear()
      return json(res, 200, { ok: true })
    }

    // 状态流转：POST /admin/apis/:id/status {status}
    if (resource === 'apis' && id && sub === 'status' && req.method === 'POST') {
      const { status } = JSON.parse((await readBody(req)).toString('utf-8') || '{}')
      const api = store.get('apis', id)
      if (!api) return json(res, 404, { message: 'API 不存在' })
      if (!['draft', 'published', 'offline', 'deprecated'].includes(status)) return json(res, 400, { message: '非法状态' })
      api.status = status
      api.updatedAt = new Date().toISOString().slice(0, 10)
      store.upsert('apis', api)
      return json(res, 200, api)
    }

    const kindMap = { apis: 'apis', groups: 'groups', apps: 'apps', rules: 'rules' }
    const kind = kindMap[resource]

    if (kind && req.method === 'POST' && !id) {
      const obj = JSON.parse((await readBody(req)).toString('utf-8') || '{}')
      if (!obj.id) return json(res, 400, { message: '缺少 id' })
      store.upsert(kind, obj)
      // 删除 API 时联动清理应用授权（前端已保证，后端兜底）
      return json(res, 200, obj)
    }

    if (kind && req.method === 'DELETE' && id) {
      store.remove(kind, id)
      if (kind === 'apis') {
        // 联动移除应用授权
        for (const app of store.list('apps')) {
          if (app.apiIds.includes(id)) {
            app.apiIds = app.apiIds.filter((x) => x !== id)
            store.upsert('apps', app)
          }
        }
      }
      return json(res, 200, { ok: true })
    }

    if (resource === 'alerts' && id && sub === 'ack' && req.method === 'POST') {
      const alert = store.get('alerts', id)
      if (!alert) return json(res, 404, { message: '告警不存在' })
      alert.acked = 1
      store.upsert('alerts', alert)
      return json(res, 200, alert)
    }

    return json(res, 404, { message: '未知管理接口' })
  } catch (err) {
    console.error('[admin error]', err)
    return json(res, err?.status ?? 400, { message: '请求处理失败：' + (err?.message ?? 'unknown') })
  }
}

/* ---------- 入口 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': '*',
    })
    return res.end()
  }

  try {
    if (url.pathname.startsWith('/admin/')) return await handleAdmin(req, res, url)
    if (url.pathname.startsWith('/upstream/') || url.pathname === '/upstream') return await handleUpstream(req, res, url)
    if (url.pathname.startsWith('/gw/') || url.pathname === '/gw') return await handleGateway(req, res, url)
    if (url.pathname === '/healthz') return json(res, 200, { ok: true, uptime: process.uptime() })
    return json(res, 404, { message: 'not found' })
  } catch (err) {
    console.error('[server error]', err)
    return json(res, 500, { message: 'internal error' })
  }
})

server.listen(PORT, () => {
  console.log(`[server] WebAPI 管理平台后端已启动: http://localhost:${PORT}`)
  console.log(`[server] 管理 API: /admin/*  网关入口: /gw/*  mock 上游: /upstream/*`)
})
