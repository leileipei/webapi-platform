// WebAPI 管理平台后端：管理 API + 真实网关转发 + 内置 mock 上游 + 前端静态托管
// 零第三方依赖：node:http + node:sqlite
import http from 'node:http'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { lookup } from 'node:dns/promises'
import { db, store, recordMetric, queryMetrics, apiCallStats, seedAll, addLog, queryLogs, queryMinuteMetrics, addAudit, queryAudit, createBackup, restoreFrom, backupStream, fileSize, removeFile } from './db.js'
import { ensureAdmin, login, verify, logout, changePassword, hasRole, listUsers, upsertUser, deleteUser, revokeAllSessions } from './auth.js'
import { runArchive, listArchives, openArchive, startArchiver, RETENTION_DAYS } from './archive.js'

ensureAdmin()
// 存量数据迁移：v1.4.0 起 SecretKey 只存 SHA-256 哈希，明文不再落库
for (const a of store.list('apps')) {
  if (a.secretKey) {
    a.secretKeyHash = skHash(a.secretKey)
    delete a.secretKey
    store.upsert('apps', a)
  }
}
startArchiver()

const PORT = process.env.PORT ? Number(process.env.PORT) : 3100
// 默认绑定所有网卡，局域网内其他计算机可通过 http://<本机IP>:3100 访问
const HOST = process.env.HOST ?? '0.0.0.0'
// 管理接口（/admin/*）跨域白名单，逗号分隔；默认空 = 不下发 CORS 头（同源部署无需 CORS）
const ADMIN_CORS_ORIGINS = (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean)
// 请求体上限：网关转发默认 10MB（GATEWAY_MAX_BODY 可覆盖，单位字节），管理接口收紧
const GW_MAX_BODY = Math.max(1024, Number(process.env.GATEWAY_MAX_BODY ?? 10 * 1024 * 1024))
// 连通性测试是否允许访问本机回环地址（默认禁止，防 SSRF 探测本机服务；云元数据地址始终禁止）
const ALLOW_LOCAL_TEST = process.env.ALLOW_LOCAL_TEST === '1'

/** 加密安全的应用密钥生成（base64url，ak 16 字节 / sk 32 字节） */
const genKey = (prefix, bytes) => `${prefix}_${randomBytes(bytes).toString('base64url')}`
/** SecretKey 存储哈希（SHA-256）。网关比对哈希值；SK 高熵随机串，无需慢哈希 */
function skHash(sk) {
  return createHash('sha256').update(String(sk ?? '')).digest('hex')
}
/** 常量时间字符串比较（防时序侧信道） */
const safeEq = (a, b) => {
  const ba = Buffer.from(String(a ?? ''))
  const bb = Buffer.from(String(b ?? ''))
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}
/** 客户端真实 IP：仅在 TRUST_PROXY=1（前方有受信反向代理）时采用 X-Forwarded-For 首跳，否则取 socket 地址防伪造 */
const clientIp = (req) => {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = req.headers['x-forwarded-for']
    if (fwd) return String(fwd).split(',')[0].trim()
  }
  return req.socket.remoteAddress
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(__dirname, '..', 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

/** 安全响应头（管理接口与静态资源；网关透传响应不加，保持代理透明） */
const SECURE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}
/** 仅 HTML 入口加 CSP（构建产物无内联脚本；图表组件运行时注入内联样式需 style unsafe-inline） */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

/** 托管前端构建产物（dist/），未命中路径回退 index.html（SPA 路由） */
function serveStatic(req, res, url) {
  if (!existsSync(DIST_DIR)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURE_HEADERS })
    return res.end('前端尚未构建：请先执行 npm run build，或开发模式使用 npm run dev')
  }
  let filePath = normalize(join(DIST_DIR, decodeURIComponent(url.pathname)))
  // 防目录穿越（比较时补路径分隔符，避免 /dist-evil 型前缀绕过；Windows 下分隔符为 \，必须用 sep 否则全部误拦截）
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURE_HEADERS })
    return res.end('forbidden')
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(DIST_DIR, 'index.html')
  }
  const body = readFileSync(filePath)
  const isHtml = extname(filePath).toLowerCase() === '.html'
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURE_HEADERS,
    ...(isHtml ? { 'Content-Security-Policy': CSP } : {}),
  })
  res.end(body)
}

/* ---------- 运行时状态（内存） ---------- */
// AccessKey 索引：ak -> app 快照，避免网关每请求全量解析应用表；应用增删改/备份恢复/重置演示数据时失效重建
let akIndex = null
function getAppByAk(ak) {
  if (!akIndex) {
    akIndex = new Map()
    for (const a of store.list('apps')) akIndex.set(a.accessKey, a)
  }
  return akIndex.get(String(ak)) ?? null
}
// 限流：apiId -> { sec, count }
const rateBuckets = new Map()
// 熔断：apiId -> [{ts, ok}]
const cbWindows = new Map()
// 熔断恢复：apiId -> 熔断截止时间戳
const cbOpenUntil = new Map()
// 健康度：apiId -> 最近 50 次结果 [{ts, ok, latency}]
const recentCalls = new Map()
// QPS 统计：apiId -> Map<秒时间戳, 次数>（近 60 秒滑动窗口，独立于健康度 50 条截断——
// 否则突发流量下 QPS 告警值会被压缩到 50/60 ≈ 0.83 以下，永远触发不了告警）
const qpsBuckets = new Map()

function pushQps(apiId) {
  const nowSec = Math.floor(Date.now() / 1000)
  let m = qpsBuckets.get(apiId)
  if (!m) { m = new Map(); qpsBuckets.set(apiId, m) }
  m.set(nowSec, (m.get(nowSec) ?? 0) + 1)
  for (const sec of m.keys()) if (sec <= nowSec - 60) m.delete(sec)
}

/** 近 60 秒滑动窗口的平均 QPS */
function currentQps(apiId) {
  const m = qpsBuckets.get(apiId)
  if (!m) return 0
  const nowSec = Math.floor(Date.now() / 1000)
  let sum = 0
  for (const [sec, c] of m) if (sec > nowSec - 60) sum += c
  return sum / 60
}

function pushRecent(apiId, ok, latency) {
  pushQps(apiId)
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
/**
 * 统一 JSON 响应。
 * corsOrigin：'*'（网关公开调用）或白名单命中的 Origin；缺省不下发 CORS 头（同源部署无需 CORS，防止任意站点跨域读管理接口）。
 */
function json(res, code, obj, corsOrigin) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    ...SECURE_HEADERS,
    ...(corsOrigin
      ? {
          'Access-Control-Allow-Origin': corsOrigin,
          'Vary': 'Origin',
          'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Access-Key,X-Secret-Key',
        }
      : {}),
  })
  res.end(body)
}

/**
 * 读取请求体，超限返回 null 并销毁连接（防大 body 内存 DoS）。
 * 调用方必须判空：`const body = await readBody(req, limit); if (!body) return json(res, 413, ...)`
 */
function readBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let overflow = false
    req.on('data', (c) => {
      size += c.length
      if (size > maxBytes) {
        overflow = true
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(overflow ? null : Buffer.concat(chunks)))
    req.on('error', () => resolve(overflow ? null : Buffer.alloc(0)))
    req.on('close', () => { if (overflow) resolve(null) })
  })
}

/** 管理接口 CORS：仅当请求 Origin 命中 CORS_ORIGIN 白名单时回显，否则不下发（同源不受影响） */
function adminCorsOrigin(req) {
  const o = req.headers.origin
  if (!o || ADMIN_CORS_ORIGINS.length === 0) return null
  return ADMIN_CORS_ORIGINS.includes(o) ? o : null
}

/** SSRF 防护：解析目标主机，拦截云元数据、回环与链路本地地址（ALLOW_LOCAL_TEST=1 可放行回环用于本机联调） */
async function assertTargetAllowed(parsed) {
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') {
    if (!ALLOW_LOCAL_TEST) throw new Error('目标地址被安全策略拦截（本机/元数据地址）')
  }
  const { address } = await lookup(host)
  const ip = address.toLowerCase()
  const v4 = ip.split('.')
  if (v4.length === 4) {
    const [a, b] = v4.map(Number)
    if (a === 169 && b === 254) throw new Error('目标地址被安全策略拦截（链路本地/云元数据地址）')
    if (!ALLOW_LOCAL_TEST && (a === 127 || (a === 0 && b === 0))) throw new Error('目标地址被安全策略拦截（本机回环地址）')
  } else {
    if (ip === '::1' && !ALLOW_LOCAL_TEST) throw new Error('目标地址被安全策略拦截（本机回环地址）')
    if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) throw new Error('目标地址被安全策略拦截（链路本地/内网 IPv6 地址）')
  }
}

/** 网关转发用 SSRF 校验：带 60 秒结果缓存，避免每次转发都做一次 DNS 解析 */
const ssrfCache = new Map() // host -> { ok, msg, exp }
async function assertBackendAllowed(backendUrl) {
  const parsed = new URL(backendUrl)
  const host = parsed.hostname.toLowerCase()
  const cached = ssrfCache.get(host)
  if (cached && cached.exp > Date.now()) {
    if (cached.ok) return
    throw new Error(cached.msg)
  }
  try {
    await assertTargetAllowed(parsed)
    ssrfCache.set(host, { ok: true, exp: Date.now() + 60_000 })
  } catch (err) {
    ssrfCache.set(host, { ok: false, msg: err.message, exp: Date.now() + 60_000 })
    throw err
  }
}

/** 把注册路径 /api/v1/users/{id} 编译成匹配器；编译结果按路径字符串缓存，避免每请求重复编译正则。
 *  segs：逐段标记 1=静态段 / 0={param} 占位段，用于路由特异性比较 */
const compiledPathCache = new Map()
function compilePath(path) {
  const cached = compiledPathCache.get(path)
  if (cached) return cached
  const names = []
  const pattern = path.replace(/[.*+?^${}()|[\]\\]/g, (m) => '\\' + m).replace(/\\\{(\w+)\\\}/g, (_, n) => {
    names.push(n)
    return '([^/]+)'
  })
  const segs = path.split('/').map((s) => (/^\{\w+\}$/.test(s) ? 0 : 1))
  const compiled = { re: new RegExp('^' + pattern + '$'), names, segs }
  compiledPathCache.set(path, compiled)
  return compiled
}

/** 特异性比较：能命中同一请求的两条路由段数必然相同；逐段比较，首个不同位置上静态段（1）优先于参数段（0） */
function moreSpecific(segsA, segsB) {
  for (let i = 0; i < segsA.length; i++) {
    if (segsA[i] !== segsB[i]) return segsA[i] > segsB[i]
  }
  return false
}

/** 判断两个路径模式是否歧义冲突：段数相同、逐段兼容（静态段相等或至少一方为 {param}）、且参数/静态形态完全一致（与参数名无关）。
 *  一方静态一方参数的交叉形态（如 /goods/search 与 /goods/{id}）不算冲突——匹配时静态优先，结果确定 */
function routeAmbiguous(p1, p2) {
  const s1 = p1.split('/')
  const s2 = p2.split('/')
  if (s1.length !== s2.length) return false
  for (let i = 0; i < s1.length; i++) {
    const t1 = /^\{\w+\}$/.test(s1[i])
    const t2 = /^\{\w+\}$/.test(s2[i])
    if (t1 !== t2) return false
    if (!t1 && s1[i] !== s2[i]) return false
  }
  return true
}

/* ---------- API 定义服务端 Schema 校验 ---------- */
const API_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
const PARAM_TYPES = ['string', 'number', 'boolean', 'object', 'array']
/** 注册/编辑 API 时的服务端校验（前端校验仅改善体验，不可信任）。返回错误文案或 null */
function validateApiDef(obj) {
  if (!/^[a-zA-Z0-9_\-]{2,64}$/.test(String(obj.id ?? ''))) return 'id 需为 2~64 位字母/数字/下划线/中划线'
  if (!obj.name || String(obj.name).trim().length === 0 || String(obj.name).length > 64) return '名称必填且不超过 64 字'
  if (!API_METHODS.includes(obj.method)) return `非法请求方法：${obj.method}（支持 ${API_METHODS.join('/')}）`
  const p = String(obj.path ?? '')
  if (!p.startsWith('/') || p.length > 128) return '请求路径需以 / 开头且不超过 128 字符'
  if (!/^\/[\w\-/{}]*$/.test(p)) return '请求路径含非法字符（支持字母、数字、-、_、/ 与 {param} 占位符）'
  if ((p.match(/\{/g) ?? []).length !== (p.match(/\}/g) ?? []).length) return '路径占位符 {param} 大括号不配对'
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(String(obj.version ?? 'v1'))) return '版本号格式不合法'
  // oauth2/jwt 网关在数据面尚未实现拦截逻辑，允许注册会造成"看似有鉴权实则裸奔"，直接拒绝
  if (!['none', 'apikey'].includes(obj.auth)) return '认证方式仅支持 none / apikey（oauth2、jwt 暂未实现，注册后网关将无法正确拦截）'
  if (!Number.isInteger(obj.timeout) || obj.timeout < 100 || obj.timeout > 60000) return '超时需为 100~60000 毫秒的整数'
  if (!Number.isInteger(obj.retry) || obj.retry < 0 || obj.retry > 3) return '失败重试次数需为 0~3 的整数'
  if (!Number.isInteger(obj.qps) || obj.qps < 1 || obj.qps > 1_000_000) return 'QPS 限流需为 1~1000000 的整数'
  for (const [label, list] of [['Query 参数', obj.queryParams], ['请求头', obj.headers], ['Body 参数', obj.bodyParams]]) {
    if (list === undefined || list === null) continue
    if (!Array.isArray(list)) return `${label}定义必须是数组`
    for (const prm of list) {
      if (!prm?.name || String(prm.name).length > 64) return `${label}中存在未命名或名称超长的参数`
      if (!PARAM_TYPES.includes(prm.type)) return `参数「${prm.name}」类型非法（支持 ${PARAM_TYPES.join('/')}）`
    }
  }
  if (obj.circuitBreaker) {
    const cb = obj.circuitBreaker
    if (cb.errorRateThreshold !== undefined && (typeof cb.errorRateThreshold !== 'number' || cb.errorRateThreshold < 1 || cb.errorRateThreshold > 100)) return '熔断错误率阈值需为 1~100'
    if (cb.windowSec !== undefined && (typeof cb.windowSec !== 'number' || cb.windowSec < 5 || cb.windowSec > 300)) return '熔断统计窗口需为 5~300 秒'
  }
  // 分组引用完整性：groupId 必须指向已存在的分组
  if (obj.groupId && !store.get('groups', obj.groupId)) return '所属分组不存在'
  return null
}

/** 网关入参校验：必填 Query 参数缺失 / number、boolean 类型不符时拒绝调用（在鉴权之后执行，防止未授权方探测参数结构） */
function validateCallParams(api, url) {
  for (const qp of api.queryParams ?? []) {
    const v = url.searchParams.get(qp.name)
    if (qp.required && (v === null || v === '')) return `缺少必填 Query 参数「${qp.name}」`
    if (v !== null && qp.type === 'number' && !/^-?\d+(\.\d+)?$/.test(v)) return `Query 参数「${qp.name}」需为数字`
    if (v !== null && qp.type === 'boolean' && !['true', 'false'].includes(v)) return `Query 参数「${qp.name}」需为布尔值（true/false）`
  }
  return null
}

function matchApi(apis, method, reqPath) {
  // 收集全部命中项后按特异性取最优：静态段优先于 {param} 段，
  // 避免参数化路由遮蔽静态路由（匹配结果与注册顺序无关）
  let best = null
  let methodMismatch = false
  for (const api of apis) {
    const { re, names, segs } = compilePath(api.path)
    const m = re.exec(reqPath)
    if (!m) continue
    if (api.method !== method) { methodMismatch = true; continue }
    if (!best || moreSpecific(segs, best.segs)) {
      const params = {}
      names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])))
      best = { api, params, segs }
    }
  }
  if (best) return { api: best.api, params: best.params }
  if (methodMismatch) return { api: null, methodMismatch: true } // 路径命中但方法不符 → 405
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
      // 真实 QPS：近 60 秒滑动窗口（独立的按秒桶统计，不受健康度 50 条截断影响）
      const qps = currentQps(apiId)
      if (qps > rule.threshold) {
        hit = true
        detail = `当前 QPS ${qps.toFixed(1)}（近 60 秒均值），阈值 ${rule.threshold}`
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
  // 转发前 SSRF 兜底校验（注册时已校验；此处带 60s 结果缓存防 DNS 每请求开销，双重防护防备份恢复/直写库绕过）
  await assertBackendAllowed(api.backendUrl)
  // 替换后端地址中的 {param} 占位符
  let target = api.backendUrl
  for (const [k, v] of Object.entries(params)) target = target.replaceAll(`{${k}}`, encodeURIComponent(v))
  // backendUrl 可能已自带 query（含 ?），追加时避免双问号
  if (url.search) target += target.includes('?') ? '&' + url.search.slice(1) : url.search

  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    const key = k.toLowerCase()
    // 剥离 hop-by-hop 头与平台内部凭证（AccessKey/SecretKey 不转发给上游，防第三方后端窃取重放）
    if (['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding',
      'keep-alive', 'upgrade', 'proxy-authorization', 'te', 'trailer',
      'x-access-key', 'x-secret-key'].includes(key)) continue
    headers[k] = v
  }
  if (body.length > 0 && !headers['content-type']) headers['content-type'] = 'application/json'

  let lastErr = null
  // 仅幂等方法自动重试；POST/PATCH 等非幂等方法 5xx 重试会导致上游重复执行（重复下单/重复扣款），一律不重试
  const IDEMPOTENT = ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']
  const attempts = 1 + (IDEMPOTENT.includes(api.method) ? (api.retry || 0) : 0)
  for (let i = 0; i < attempts; i++) {
    try {
      const upstream = await fetch(target, {
        method: api.method,
        headers,
        body: ['GET', 'HEAD'].includes(api.method) || body.length === 0 ? undefined : body,
        signal: AbortSignal.timeout(api.timeout || 3000),
        redirect: 'manual',
      })
      if (upstream.status >= 500 && i < attempts - 1) {
        await upstream.body?.cancel().catch(() => {}) // 丢弃本次响应体后立即重试
        continue
      }
      // 响应体流式返回（不读入内存），由调用方 pipe 给客户端：大文件下载不再整报文缓冲
      const stream = upstream.body ? Readable.fromWeb(upstream.body) : Readable.from([])
      return { status: upstream.status, stream, contentType: upstream.headers.get('content-type') ?? 'application/json' }
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
  const log = { method: req.method, path: reqPath + (url.search || ''), ip: clientIp(req) }
  const writeLog = (status, extra = {}) =>
    addLog({ ...log, status, latency: performance.now() - start, ...extra })

  if (!matched) {
    writeLog(404, { message: '路由不存在' })
    return json(res, 404, { code: 40404, message: `网关未找到路由: ${req.method} ${reqPath}` }, '*')
  }
  if (matched.methodMismatch) {
    writeLog(405, { message: '请求方法不允许' })
    return json(res, 405, { code: 40500, message: '请求方法不允许' }, '*')
  }

  const { api, params } = matched
  log.apiId = api.id
  log.apiName = api.name

  // 生命周期检查
  if (api.status !== 'published') {
    writeLog(403, { message: `API 状态为 ${api.status}` })
    return json(res, 403, { code: 40301, message: `API「${api.name}」当前状态为 ${api.status}，不可调用` }, '*')
  }

  // 鉴权：AccessKey 定位应用（内存索引） + SecretKey 哈希校验（双因子，均常量时间比较）
  if (api.auth === 'apikey') {
    const ak = req.headers['x-access-key']
    const app = ak ? getAppByAk(ak) : null
    if (app) log.appName = app.name
    if (!app) {
      writeLog(401, { message: '缺少或无效的 AccessKey' })
      return json(res, 401, { code: 40100, message: '缺少或无效的 X-Access-Key' }, '*')
    }
    const sk = req.headers['x-secret-key']
    if (!sk || !app.secretKeyHash || !safeEq(app.secretKeyHash, skHash(sk))) {
      writeLog(401, { appName: app.name, message: '缺少或无效的 SecretKey' })
      return json(res, 401, { code: 40102, message: '缺少或无效的 X-Secret-Key' }, '*')
    }
    if (app.status !== 'active') {
      writeLog(401, { message: `应用「${app.name}」已停用` })
      return json(res, 401, { code: 40101, message: `应用「${app.name}」已被停用` }, '*')
    }
    if (!app.apiIds.includes(api.id)) {
      writeLog(403, { message: `应用「${app.name}」未授权` })
      return json(res, 403, { code: 40302, message: `应用「${app.name}」未被授权调用该 API` }, '*')
    }
  }

  // 入参 Schema 校验（必填/类型），在鉴权之后执行
  const paramErr = validateCallParams(api, url)
  if (paramErr) {
    writeLog(400, { appName: log.appName, message: paramErr })
    return json(res, 400, { code: 40001, message: paramErr }, '*')
  }

  // 限流
  if (!checkRateLimit(api)) {
    writeLog(429, { message: `QPS 超上限 ${api.qps}` })
    return json(res, 429, { code: 42900, message: `触发限流：QPS 上限 ${api.qps}` }, '*')
  }

  // 熔断
  if (!checkCircuitBreaker(api)) {
    writeLog(503, { message: '熔断开启' })
    return json(res, 503, { code: 50301, message: '熔断开启：后端错误率过高，请稍后重试' }, '*')
  }

  const body = await readBody(req, GW_MAX_BODY)
  if (!body) {
    writeLog(413, { message: `请求体超过上限 ${GW_MAX_BODY} 字节` })
    return json(res, 413, { code: 41300, message: '请求体过大' }, '*')
  }
  let ok = true
  try {
    const result = await forward(api, params, req, body, url)
    ok = result.status < 500
    const latency = performance.now() - start // 流式模式下为 TTFB（首字节时间）
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
    // 上游响应体流式透传给客户端（背压由 pipe 处理）；中途上游断流时销毁连接，客户端收到截断响应
    result.stream.on('error', () => res.destroy())
    result.stream.pipe(res)
  } catch (err) {
    ok = false
    const latency = performance.now() - start
    pushRecent(api.id, ok, latency)
    recordMetric(api.id, ok, latency)
    evaluateAlerts(api.id)
    updateCircuitBreaker(api)
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    const isSsrfBlock = String(err?.message ?? '').includes('安全策略拦截')
    if (isSsrfBlock) {
      writeLog(403, { message: err.message })
      return json(res, 403, { code: 40303, message: err.message }, '*')
    }
    writeLog(isTimeout ? 504 : 502, { message: isTimeout ? '后端超时' : `后端不可达 ${err?.cause?.code ?? ''}` })
    json(res, isTimeout ? 504 : 502, {
      code: isTimeout ? 50400 : 50200,
      message: isTimeout ? `后端超时（>${api.timeout}ms）` : `后端不可达：${err?.cause?.code ?? err?.message ?? 'unknown'}`,
    }, '*')
  }
}

/* ---------- 内置 mock 上游 ---------- */
async function handleUpstream(req, res, url) {
  const body = await readBody(req, 1024 * 1024)
  if (!body) return json(res, 413, { code: 41300, message: '请求体过大' })
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
function fullState(role) {
  const stats = apiCallStats()
  const apis = store.list('apis').map((a) => ({
    ...a,
    health: computeHealth(a.id) === 'unknown' ? (a.status === 'published' ? 'healthy' : 'unknown') : computeHealth(a.id),
    ...(stats.get(a.id) ?? { todayCalls: 0, calls30d: 0 }),
  }))
  // SecretKey 自 v1.4.0 起仅存储哈希、永不下发；所有角色看到的都是脱敏占位（仅创建/重置时一次性返回明文）
  const apps = store.list('apps').map((a) => {
    const { secretKeyHash, ...rest } = a
    return { ...rest, secretKey: 'sk_****（已加密存储，仅创建/重置时可见）****' }
  })
  return {
    apis,
    groups: store.list('groups'),
    apps,
    alertRules: store.list('rules'),
    alertRecords: store.list('alerts').sort((a, b) => (a.time < b.time ? 1 : -1)),
  }
}

async function handleAdmin(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean) // ['admin', ...]
  const resource = parts[1]
  const id = parts[2] ? decodeURIComponent(parts[2]) : null
  const sub = parts[3]
  // 统一 JSON 响应：仅 Origin 命中 CORS_ORIGIN 白名单时回显跨域头
  const j = (code, obj) => json(res, code, obj, adminCorsOrigin(req))

  try {
    // ---- 认证接口（登录公开，其余需会话） ----
    if (resource === 'auth') {
      if (id === 'login' && req.method === 'POST') {
        const raw = await readBody(req, 64 * 1024)
        if (!raw) return j(413, { message: '请求体过大' })
        const { username, password } = JSON.parse(raw.toString('utf-8') || '{}')
        if (!username || !password) return j( 400, { message: '请输入用户名和密码' })
        const result = login(String(username), String(password))
        if (!result) {
          addAudit({ username: String(username), action: '登录失败', ip: clientIp(req) })
          return j( 401, { message: '用户名或密码错误' })
        }
        addAudit({ username: result.username, role: result.role, action: '登录成功', detail: result.mustChangePwd ? '使用初始密码，需强制改密' : undefined, ip: clientIp(req) })
        return j( 200, result)
      }
      const session = verify(req)
      if (!session) return j( 401, { message: '未登录或会话已过期' })
      if (id === 'me' && req.method === 'GET') return j( 200, { username: session.username, role: session.role })
      if (id === 'logout' && req.method === 'POST') {
        logout(session.token)
        addAudit({ username: session.username, role: session.role, action: '退出登录', ip: clientIp(req) })
        return j( 200, { ok: true })
      }
      if (id === 'password' && req.method === 'POST') {
        const rawPwd = await readBody(req, 64 * 1024)
        if (!rawPwd) return j(413, { message: '请求体过大' })
        const { oldPassword, newPassword } = JSON.parse(rawPwd.toString('utf-8') || '{}')
        const r = changePassword(session.username, String(oldPassword ?? ''), String(newPassword ?? ''))
        if (r.ok) addAudit({ username: session.username, role: session.role, action: '修改密码', ip: clientIp(req) })
        return j( r.ok ? 200 : 400, r)
      }
      return j( 404, { message: '未知认证接口' })
    }

    // ---- 其余管理接口一律要求登录 ----
    const session = verify(req)
    if (!session) return j( 401, { message: '未登录或会话已过期' })

    // ---- 强制改密硬阻断：使用初始密码的账号除 auth 段（登录/改密/退出）外不得操作任何管理接口 ----
    const urow = db.prepare('SELECT must_change_pwd FROM users WHERE username = ?').get(session.username)
    if (urow?.must_change_pwd) {
      return j( 403, { code: 40310, message: '账号须先修改初始密码后才能操作系统（请通过"修改密码"完成）' })
    }

    // ---- 接口级角色控制：viewer 只读 / operator 可注册、发布、编辑、确认告警 / admin 全部 ----
    const needRole = (minRole) => {
      if (hasRole(session, minRole)) return true
      j( 403, { message: `权限不足：该操作需要 ${minRole} 及以上角色` })
      return false
    }

    // ---- 审计辅助：记录当前会话的管理操作 ----
    const audit = (action, target, detail) =>
      addAudit({ username: session.username, role: session.role, action, target, detail, ip: clientIp(req) })

    // ---- 用户管理（仅 admin） ----
    if (resource === 'users') {
      if (!needRole('admin')) return
      if (req.method === 'GET' && !id) return j( 200, listUsers())
      if (req.method === 'POST' && !id) {
        const rawU = await readBody(req, 64 * 1024)
        if (!rawU) return j(413, { message: '请求体过大' })
        const { username, password, role } = JSON.parse(rawU.toString('utf-8') || '{}')
        const r = upsertUser({ username: String(username ?? ''), password: password ? String(password) : undefined, role })
        if (r.ok) audit('保存用户', String(username ?? ''), `角色 ${role}${password ? '，重置密码' : ''}`)
        return j( r.ok ? 200 : 400, r)
      }
      if (req.method === 'DELETE' && id) {
        const r = deleteUser(id, session.username)
        if (r.ok) audit('删除用户', id)
        return j( r.ok ? 200 : 400, r)
      }
      return j( 404, { message: '未知用户接口' })
    }

    // ---- 日志归档（仅 admin） ----
    if (resource === 'archives') {
      if (!needRole('admin')) return
      if (req.method === 'GET' && id === 'download') {
        const stream = openArchive(url.searchParams.get('file'))
        if (!stream) return j( 404, { message: '归档文件不存在' })
        audit('下载归档', url.searchParams.get('file'))
        res.writeHead(200, {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${url.searchParams.get('file')}"`,
          ...SECURE_HEADERS,
        })
        return stream.pipe(res)
      }
      if (req.method === 'GET' && !id) return j( 200, { retentionDays: RETENTION_DAYS, files: listArchives() })
      if (req.method === 'POST' && id === 'run') {
        const r = await runArchive()
        audit('手动归档', [r.file, r.auditFile].filter(Boolean).join('、') || null,
          `归档调用日志 ${r.archived} 条、审计日志 ${r.auditArchived} 条`)
        return j( 200, r)
      }
      return j( 404, { message: '未知归档接口' })
    }

    // ---- 操作审计查询（仅 admin） ----
    if (resource === 'audit-logs' && req.method === 'GET') {
      if (!needRole('admin')) return
      return j( 200, queryAudit({
        username: url.searchParams.get('username') || undefined,
        keyword: url.searchParams.get('keyword') || undefined,
        page: Math.max(1, Number(url.searchParams.get('page') ?? 1)),
        pageSize: Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? 20))),
      }))
    }

    // ---- 数据备份与恢复（仅 admin） ----
    if (resource === 'backup' && id === 'download' && req.method === 'GET') {
      if (!needRole('admin')) return
      const tmpPath = createBackup()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      audit('下载备份', `webapi-backup-${stamp}.db`, `${(fileSize(tmpPath) / 1024).toFixed(1)} KB`)
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize(tmpPath),
        'Content-Disposition': `attachment; filename="webapi-backup-${stamp}.db"`,
        ...SECURE_HEADERS,
      })
      const stream = backupStream(tmpPath)
      stream.pipe(res)
      stream.on('end', () => removeFile(tmpPath))
      stream.on('error', () => removeFile(tmpPath))
      return
    }

    if (resource === 'backup' && id === 'restore' && req.method === 'POST') {
      if (!needRole('admin')) return
      const body = await readBody(req, 200 * 1024 * 1024)
      if (!body) return j( 413, { message: '备份文件不能超过 200MB' })
      if (body.length === 0) return j( 400, { message: '请上传备份文件' })
      const includeUsers = url.searchParams.get('users') === '1'
      const r = restoreFrom(body, { includeUsers })
      if (!r.ok) return j( 400, r)
      // 运行时内存态与新数据可能不一致，清零重建
      recentCalls.clear()
      cbWindows.clear()
      cbOpenUntil.clear()
      akIndex = null
      rateBuckets.clear()
      // 恢复后审计表已被备份内容替换，追加本次恢复记录
      audit('恢复备份', null, `恢复 ${r.tables} 张数据表${includeUsers ? '（含用户账号，全部会话已注销）' : ''}`)
      if (includeUsers) revokeAllSessions()
      return j( 200, { ok: true, tables: r.tables, sessionsRevoked: includeUsers })
    }

    if (resource === 'state' && req.method === 'GET') return j( 200, fullState(session.role))

    if (resource === 'metrics' && req.method === 'GET') {
      const apiId = url.searchParams.get('apiId')
      const days = Math.min(Number(url.searchParams.get('days') ?? 30), 90)
      return j( 200, queryMetrics(apiId || null, days))
    }

    if (resource === 'logs' && id === 'minutes' && req.method === 'GET') {
      const minutes = Math.min(360, Math.max(5, Number(url.searchParams.get('minutes') ?? 60)))
      const apiId = url.searchParams.get('apiId') || undefined
      return j( 200, queryMinuteMetrics(minutes, apiId))
    }

    if (resource === 'logs' && req.method === 'GET') {
      return j( 200, queryLogs({
        apiId: url.searchParams.get('apiId') || undefined,
        statusClass: url.searchParams.get('statusClass') || undefined,
        appName: url.searchParams.get('appName') || undefined,
        keyword: url.searchParams.get('keyword') || undefined,
        page: Math.max(1, Number(url.searchParams.get('page') ?? 1)),
        pageSize: Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? 20))),
      }))
    }

    if (resource === 'reset' && req.method === 'POST') {
      if (!needRole('admin')) return
      seedAll()
      recentCalls.clear()
      cbWindows.clear()
      cbOpenUntil.clear()
      rateBuckets.clear()
      akIndex = null
      audit('重置演示数据')
      return j( 200, { ok: true })
    }

    // 连通性测试：POST /admin/test { url, method?, timeoutMs? }
    // 注册/编辑 API 时验证后端地址是否可达；能收到任意 HTTP 响应即视为可达
    if (resource === 'test' && req.method === 'POST') {
      if (!needRole('operator')) return
      const rawT = await readBody(req, 16 * 1024)
      if (!rawT) return j(413, { message: '请求体过大' })
      const { url: target, method, timeoutMs } = JSON.parse(rawT.toString('utf-8') || '{}')
      let parsed
      try {
        parsed = new URL(String(target ?? ''))
      } catch {
        return j( 400, { message: 'URL 格式不正确' })
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return j( 400, { message: '仅支持 http/https 协议' })
      }
      // SSRF 防护：拦截云元数据/回环/链路本地地址
      try {
        await assertTargetAllowed(parsed)
      } catch (err) {
        return j( 403, { message: err?.message ?? '目标地址被安全策略拦截' })
      }
      const t0 = performance.now()
      const latency = () => Math.round(performance.now() - t0)
      try {
        const resp = await fetch(parsed, {
          method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].includes(method) ? method : 'GET',
          signal: AbortSignal.timeout(Math.min(Number(timeoutMs) || 5000, 30000)),
          redirect: 'manual',
          headers: { 'User-Agent': 'WebAPI-Platform-ConnectivityCheck/1.0' },
        })
        const buf = Buffer.from(await resp.arrayBuffer())
        return j( 200, {
          reachable: true,
          status: resp.status,
          latency: latency(),
          bodyPreview: buf.toString('utf-8').slice(0, 300),
        })
      } catch (err) {
        const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        return j( 200, {
          reachable: false,
          latency: latency(),
          error: isTimeout ? `连接超时（>${Number(timeoutMs) || 5000}ms）` : `连接失败：${err?.cause?.code ?? err?.message ?? 'unknown'}`,
        })
      }
    }

    // 状态流转：POST /admin/apis/:id/status {status}
    if (resource === 'apis' && id && sub === 'status' && req.method === 'POST') {
      if (!needRole('operator')) return
      const rawS = await readBody(req, 16 * 1024)
      if (!rawS) return j(413, { message: '请求体过大' })
      const { status } = JSON.parse(rawS.toString('utf-8') || '{}')
      const api = store.get('apis', id)
      if (!api) return j( 404, { message: 'API 不存在' })
      if (!['draft', 'published', 'offline', 'deprecated'].includes(status)) return j( 400, { message: '非法状态' })
      // 严格生命周期状态机：draft → published → offline → deprecated（终态，仅可删除）；不允许跨级跳转
      const TRANSITIONS = { draft: ['published', 'deprecated'], published: ['offline'], offline: ['published', 'deprecated'], deprecated: [] }
      if (api.status !== status && !(TRANSITIONS[api.status] ?? []).includes(status)) {
        return j( 409, { message: `非法状态流转：${api.status} → ${status}。生命周期为 草稿→发布→下线→废弃（废弃为终态）` })
      }
      // 安全约束：已授权给启用中应用的 API 禁止下线/废弃，防止在线调用方业务中断
      if (status === 'offline' || status === 'deprecated') {
        const blockers = store.list('apps').filter((a) => a.status === 'active' && a.apiIds.includes(id))
        if (blockers.length > 0) {
          return j( 409, {
            message: `无法${status === 'offline' ? '下线' : '废弃'}：该 API 已授权给 ${blockers.length} 个启用中的应用（${blockers.map((a) => a.name).join('、')}），请先停用相关应用或移除授权`,
          })
        }
      }
      api.status = status
      api.updatedAt = new Date().toISOString().slice(0, 10)
      store.upsert('apis', api)
      audit('API 状态流转', api.name, `${api.method} ${api.path} → ${status}`)
      return j( 200, api)
    }

    const kindMap = { apis: 'apis', groups: 'groups', apps: 'apps', rules: 'rules' }
    const kind = kindMap[resource]

    if (kind && req.method === 'POST' && !id) {
      if (!needRole('operator')) return
      const rawK = await readBody(req, 1024 * 1024)
      if (!rawK) return j(413, { message: '请求体过大' })
      const obj = JSON.parse(rawK.toString('utf-8') || '{}')
      if (!obj.id) return j( 400, { message: '缺少 id' })
      const existing = store.get(kind, obj.id)
      // 安全约束：已发布状态的 API 不允许直接编辑，需先下线
      if (kind === 'apis' && existing && existing.status === 'published') {
        return j( 409, { message: `API「${existing.name}」当前为已发布状态，不允许编辑，请先下线` })
      }
      const isNew = !existing
      // 服务端 Schema 校验：字段类型/取值范围/枚举/引用完整性（前端校验不可信任）
      if (kind === 'apis') {
        const invalid = validateApiDef(obj)
        if (invalid) return j( 400, { message: `API 定义校验失败：${invalid}` })
        // 路由冲突检测：相同 method 下形态完全相同的参数化路由（如 /users/{id} 与 /users/{name}）会互相遮蔽，拒绝注册；
        // 交叉形态（如 /goods/search 与 /goods/{id}）允许共存，网关匹配时静态段优先，结果与注册顺序无关
        const clash = store.list('apis').find((a) => a.id !== obj.id && a.method === obj.method && routeAmbiguous(a.path, obj.path))
        if (clash) return j( 409, { message: `路由冲突：${obj.method} ${obj.path} 与已注册路由 ${clash.path}（API「${clash.name}」）形态相同，会互相遮蔽` })
        // backendUrl SSRF 注册时校验（网关转发时另有带缓存的兜底校验，双层防护）
        let backend
        try {
          backend = new URL(String(obj.backendUrl ?? ''))
        } catch {
          return j( 400, { message: '后端地址不是合法的 URL' })
        }
        try {
          await assertTargetAllowed(backend)
        } catch (e) {
          return j( 403, { message: `后端地址不允许：${e.message}` })
        }
      }
      // 应用密钥一律由服务端以加密安全随机数生成，不信任客户端提交的密钥值；
      // SK 自 v1.4.0 起只存 SHA-256 哈希，明文仅在创建/重置的本次响应中一次性返回
      let plainSk = null
      if (kind === 'apps') {
        if (isNew) {
          obj.accessKey = genKey('ak', 16)
          plainSk = genKey('sk', 32)
        } else {
          obj.accessKey = existing.accessKey // AccessKey 创建后不可变
          if (obj.resetSecret === true) {
            if (existing.status === 'active') return j( 409, { message: '启用中的应用不允许重置 SecretKey，请先停用该应用' })
            plainSk = genKey('sk', 32)
            audit('重置 SecretKey', obj.name ?? obj.id)
          }
        }
        delete obj.resetSecret
        delete obj.secretKey // 客户端提交的密钥值一律丢弃
        obj.secretKeyHash = plainSk ? skHash(plainSk) : existing.secretKeyHash
      }
      store.upsert(kind, obj)
      if (kind === 'apps') akIndex = null // 应用变更后重建 AccessKey 索引
      const kindLabel = { apis: 'API', groups: '分组', apps: '应用', rules: '告警规则' }[kind]
      audit(`${isNew ? '新建' : '更新'}${kindLabel}`, obj.name ?? obj.id)
      const resp = { ...obj }
      delete resp.secretKeyHash
      if (plainSk) resp.secretKey = plainSk // 明文仅此一次
      return j( 200, resp)
    }

    if (kind && req.method === 'DELETE' && id) {
      if (!needRole('admin')) return
      const existed = store.get(kind, id)
      // 安全约束：仅废弃（deprecated）状态的 API 允许删除，防止误删在线接口
      if (kind === 'apis' && existed && existed.status !== 'deprecated') {
        return j( 409, { message: `API「${existed.name}」当前状态为 ${existed.status}，仅废弃状态的 API 才能删除` })
      }
      // 引用保护：分组下仍有 API 时禁止删除，避免悬空引用
      if (kind === 'groups') {
        const used = store.list('apis').filter((a) => a.groupId === id)
        if (used.length > 0) {
          return j( 409, { message: `无法删除：分组「${existed?.name ?? id}」下还有 ${used.length} 个 API（${used.slice(0, 3).map((a) => a.name).join('、')}${used.length > 3 ? ' 等' : ''}），请先移除或调整其分组` })
        }
      }
      store.remove(kind, id)
      if (kind === 'apps') akIndex = null // 应用删除后重建 AccessKey 索引
      const kindLabel = { apis: 'API', groups: '分组', apps: '应用', rules: '告警规则' }[kind]
      audit(`删除${kindLabel}`, existed?.name ?? id)
      if (kind === 'apis') {
        // 联动移除应用授权
        for (const app of store.list('apps')) {
          if (app.apiIds.includes(id)) {
            app.apiIds = app.apiIds.filter((x) => x !== id)
            store.upsert('apps', app)
          }
        }
      }
      return j( 200, { ok: true })
    }

    if (resource === 'alerts' && id && sub === 'ack' && req.method === 'POST') {
      if (!needRole('operator')) return
      const alert = store.get('alerts', id)
      if (!alert) return j( 404, { message: '告警不存在' })
      alert.acked = 1
      store.upsert('alerts', alert)
      audit('确认告警', alert.ruleName, alert.message)
      return j( 200, alert)
    }

    return j( 404, { message: '未知管理接口' })
  } catch (err) {
    console.error('[admin error]', err)
    // 已知业务异常（带 status，如登录锁定 429）透传安全文案；未知异常不泄漏内部细节
    if (err?.status) return j( err.status, { message: err.message || '请求被拒绝' })
    return j( 400, { message: '请求格式不正确或处理失败' })
  }
}

/* ---------- 入口 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'OPTIONS') {
    // 网关公开调用保持 *；管理接口仅回显 CORS_ORIGIN 白名单内的 Origin（默认不下发，同源部署无需 CORS）
    const isGw = url.pathname.startsWith('/gw')
    const origin = isGw ? '*' : adminCorsOrigin(req)
    res.writeHead(204, origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Vary': 'Origin',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Access-Key,X-Secret-Key',
        }
      : {})
    return res.end()
  }

  try {
    if (url.pathname.startsWith('/admin/')) return await handleAdmin(req, res, url)
    if (url.pathname.startsWith('/upstream/') || url.pathname === '/upstream') return await handleUpstream(req, res, url)
    if (url.pathname.startsWith('/gw/') || url.pathname === '/gw') return await handleGateway(req, res, url)
    if (url.pathname === '/healthz') return json(res, 200, { ok: true, uptime: process.uptime() })
    // 其余 GET 请求交给前端静态托管（SPA）
    if (req.method === 'GET') return serveStatic(req, res, url)
    return json(res, 404, { message: 'not found' })
  } catch (err) {
    console.error('[server error]', err)
    return json(res, 500, { message: 'internal error' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[server] WebAPI 管理平台已启动: http://${HOST}:${PORT}（本机访问 http://localhost:${PORT}）`)
  console.log(`[server] 控制台: /  管理 API: /admin/*  网关入口: /gw/*  mock 上游: /upstream/*`)
})
