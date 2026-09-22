/**
 * 端到端冒烟测试：登录 → 注册 API → 连通性测试 → 发布 → 应用授权 → 网关调用 → 安全管控 → 日志/审计
 *
 * 用法（需先启动后端实例）：
 *   node server/index.js &          # 默认 3100
 *   node scripts/e2e.mjs            # 或 BASE=http://host:port node scripts/e2e.mjs
 *
 * 注意：会在目标实例中创建 id 为 smoke-api-1 / smoke-app-1 / smoke-app-2 的测试数据，
 * 请对测试实例运行，勿对生产数据运行。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3100'
// 管理员口令可被环境变量覆盖（CI 冒烟步骤已完成强制改密时需传入新口令）；
// 本机重复运行时，上次强制改密生成的随机口令保存在 .e2e-admin-pwd（按 BASE 区分，勿提交）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const PWD_FILE = join(dirname(fileURLToPath(import.meta.url)), '.e2e-admin-pwd.json')
const readSavedPwd = () => {
  try { return JSON.parse(readFileSync(PWD_FILE, 'utf-8'))[BASE] ?? null } catch { return null }
}
const savePwd = (pwd) => {
  let all = {}
  try { all = JSON.parse(readFileSync(PWD_FILE, 'utf-8')) } catch { /* 首次 */ }
  all[BASE] = pwd
  writeFileSync(PWD_FILE, JSON.stringify(all))
}
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || readSavedPwd() || 'Admin@123'
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
}
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) })

try {
  // 1. 健康检查
  let r = await j(await fetch(`${BASE}/healthz`))
  ok('健康检查 /healthz', r.status === 200 && r.body.ok === true)

  // 2. 管理员登录
  let ADMIN_PASSWORD_USED = ADMIN_PASSWORD
  r = await j(await fetch(`${BASE}/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }) }))
  // 保存的口令失效（如实例数据已重建）时回退默认初始密码
  if (r.status === 401 && !process.env.E2E_ADMIN_PASSWORD && ADMIN_PASSWORD !== 'Admin@123') {
    ADMIN_PASSWORD_USED = 'Admin@123'
    r = await j(await fetch(`${BASE}/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin@123' }) }))
  }
  ok('管理员登录', r.status === 200 && !!r.body.token)
  if (!r.body?.token) throw new Error('登录失败，后续用例无法执行')
  let token = r.body.token

  // 2a. 初始密码账号被服务端硬阻断（除改密外所有管理接口 403），先完成强制改密再续测
  if (r.body.mustChangePwd) {
    const blocked = await j(await fetch(`${BASE}/admin/apis`, { headers: { Authorization: `Bearer ${token}` } }))
    ok('初始密码状态管理接口被阻断(40310)', blocked.status === 403 && blocked.body?.code === 40310)
    const newPwd = `E2e!${Date.now()}x`
    const cp = await j(await fetch(`${BASE}/admin/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ oldPassword: ADMIN_PASSWORD_USED, newPassword: newPwd }) }))
    ok('强制改密完成', cp.status === 200)
    savePwd(newPwd)
    ADMIN_PASSWORD_USED = newPwd
    const relogin = await j(await fetch(`${BASE}/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: newPwd }) }))
    ok('改密后重新登录', relogin.status === 200 && !!relogin.body.token && !relogin.body.mustChangePwd)
    if (!relogin.body?.token) throw new Error('改密后登录失败')
    token = relogin.body.token
  }
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  // 2b. 错误密码应拒绝
  r = await j(await fetch(`${BASE}/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' }) }))
  ok('错误密码被拒绝(401)', r.status === 401)

  // 2c. 清理上次运行残留的冒烟数据（状态机要求 published → offline → deprecated → 删除）
  for (const appId of ['smoke-app-1', 'smoke-app-2']) {
    await fetch(`${BASE}/admin/apps/${appId}`, { method: 'DELETE', headers: H }).catch(() => {})
  }
  await fetch(`${BASE}/admin/groups/smoke-group-1`, { method: 'DELETE', headers: H }).catch(() => {})
  for (const apiId of ['smoke-api-1', 'smoke-param', 'smoke-static', 'smoke-api-shadow', 'smoke-body']) {
    await fetch(`${BASE}/admin/apis/${apiId}/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'offline' }) }).catch(() => {})
    await fetch(`${BASE}/admin/apis/${apiId}/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'deprecated' }) }).catch(() => {})
    await fetch(`${BASE}/admin/apis/${apiId}`, { method: 'DELETE', headers: H }).catch(() => {})
  }

  // 3. 注册新 API（草稿）
  const api = {
    id: 'smoke-api-1', name: '冒烟测试API', method: 'GET', path: '/api/v1/smoke/{id}',
    backendUrl: `${BASE}/upstream/echo/{id}`, groupId: null,
    status: 'draft', auth: 'apikey', qps: 100, timeout: 3000, retry: 1,
    circuitBreaker: { enabled: false }, createdAt: '2026-09-07', updatedAt: '2026-09-07',
  }
  r = await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify(api) }))
  ok('注册 API（草稿）', r.status === 200 && r.body.id === api.id)

  // 3b. 路由唯一约束：相同 method+path 注册应 409
  r = await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify({ ...api, id: 'smoke-api-dup' }) }))
  ok('重复路由注册被拒(409)', r.status === 409)

  // 3b2. 参数化路由冲突：同形占位符路由（/smoke/{name} 与 /smoke/{id}）应 409，与参数名无关
  r = await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify({ ...api, id: 'smoke-api-shadow', path: '/api/v1/smoke/{name}' }) }))
  ok('同形参数路由冲突被拒(409)', r.status === 409, `status=${r.status} ${r.body?.message ?? ''}`)

  // 3c. 分组引用保护：分组下有 API 时删除应 409
  await j(await fetch(`${BASE}/admin/groups`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'smoke-group-1', name: '冒烟分组', createdAt: '2026-09-07' }) }))
  await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify({ ...api, groupId: 'smoke-group-1' }) }))
  r = await j(await fetch(`${BASE}/admin/groups/smoke-group-1`, { method: 'DELETE', headers: H }))
  ok('分组引用保护(409)', r.status === 409)
  await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify({ ...api, groupId: null }) }))
  r = await j(await fetch(`${BASE}/admin/groups/smoke-group-1`, { method: 'DELETE', headers: H }))
  ok('空分组可删除(200)', r.status === 200)

  // 3d. backendUrl SSRF 注册时校验：云元数据地址应 403（用独立路径避免先触发路由唯一约束）
  r = await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify({ ...api, id: 'smoke-api-ssrf', path: '/api/v1/smoke-ssrf', backendUrl: 'http://169.254.169.254/latest/meta-data' }) }))
  ok('注册时 SSRF 拦截(403)', r.status === 403, `status=${r.status} ${r.body?.message ?? ''}`)

  // 3e. 服务端 Schema 校验：非法方法 / 未实现认证方式 / 悬空分组引用 均拒绝
  r = await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify({ ...api, id: 'smoke-api-x1', path: '/api/v1/smoke-x1', method: 'BREW' }) }))
  ok('非法请求方法被拒(400)', r.status === 400)
  r = await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify({ ...api, id: 'smoke-api-x2', path: '/api/v1/smoke-x2', auth: 'oauth2' }) }))
  ok('未实现认证方式被拒(400)', r.status === 400)
  r = await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify({ ...api, id: 'smoke-api-x3', path: '/api/v1/smoke-x3', groupId: 'no-such-group' }) }))
  ok('悬空分组引用被拒(400)', r.status === 400)

  // 4. 后端地址连通性测试
  r = await j(await fetch(`${BASE}/admin/test`, { method: 'POST', headers: H, body: JSON.stringify({ url: `${BASE}/upstream/echo/ping` }) }))
  ok('连通性测试（可达）', r.status === 200 && r.body.reachable === true, `status=${r.body.status} ${r.body.latency}ms`)
  r = await j(await fetch(`${BASE}/admin/test`, { method: 'POST', headers: H, body: JSON.stringify({ url: 'http://127.0.0.1:9/nope', timeoutMs: 2000 }) }))
  ok('连通性测试（不可达识别）', r.status === 200 && r.body.reachable === false)

  // 5. 草稿状态网关调用应被拒(403)
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`))
  ok('草稿 API 网关拒绝(403)', r.status === 403)

  // 6. 发布
  r = await j(await fetch(`${BASE}/admin/apis/${api.id}/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'published' }) }))
  ok('发布 API', r.status === 200 && r.body.status === 'published')

  // 6b. 状态机：已发布不允许直接废弃（须先下线）
  r = await j(await fetch(`${BASE}/admin/apis/${api.id}/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'deprecated' }) }))
  ok('非法状态流转被拒(409)', r.status === 409)

  // 6c. 网关入参 Schema 校验：必填缺失/类型错误拒绝，合法放行（auth=none 免密钥）
  const paramApi = { id: 'smoke-param', name: '入参校验测试', method: 'GET', path: '/api/v1/param-check', backendUrl: `${BASE}/upstream/echo`, groupId: null, status: 'draft', auth: 'none', qps: 100, timeout: 3000, retry: 0, circuitBreaker: { enabled: false }, queryParams: [{ name: 'n', type: 'number', required: true, description: '数字参数' }], createdAt: '2026-09-07', updatedAt: '2026-09-07' }
  await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify(paramApi) }))
  await j(await fetch(`${BASE}/admin/apis/smoke-param/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'published' }) }))
  r = await j(await fetch(`${BASE}/gw/api/v1/param-check`))
  ok('缺少必填参数被拒(400)', r.status === 400 && r.body?.code === 40001)
  r = await j(await fetch(`${BASE}/gw/api/v1/param-check?n=abc`))
  ok('参数类型错误被拒(400)', r.status === 400 && r.body?.code === 40001)
  r = await j(await fetch(`${BASE}/gw/api/v1/param-check?n=42`))
  ok('合法参数调用成功(200)', r.status === 200)

  // 6d. 静态路由优先于参数路由（与注册顺序无关）：/smoke/ping 应命中静态 API 而非 /smoke/{id}
  //     参数路由 smoke-api-1 是 apikey 鉴权，静态路由 smoke-static 是免鉴权；
  //     若无密钥调用返回 401 说明被参数路由遮蔽，返回 200 且转发到 static-hit 说明静态优先生效
  const staticApi = { id: 'smoke-static', name: '静态路由优先测试', method: 'GET', path: '/api/v1/smoke/ping', backendUrl: `${BASE}/upstream/echo/static-hit`, groupId: null, status: 'draft', auth: 'none', qps: 100, timeout: 3000, retry: 0, circuitBreaker: { enabled: false }, createdAt: '2026-09-07', updatedAt: '2026-09-07' }
  r = await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify(staticApi) }))
  ok('静态路由允许与参数路由共存', r.status === 200, `status=${r.status} ${r.body?.message ?? ''}`)
  await j(await fetch(`${BASE}/admin/apis/smoke-static/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'published' }) }))
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/ping`))
  ok('静态路由优先命中（不被 {id} 遮蔽）', r.status === 200 && r.body?.data?.echo?.path?.includes('static-hit'), `status=${r.status} path=${r.body?.data?.echo?.path ?? ''}`)
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42?foo=bar`))
  // 无密钥调用参数路由：返回 401 说明仍正常命中路由（鉴权拒绝），而非 404 路由丢失
  ok('参数路由仍可正常匹配(401 鉴权而非 404)', r.status === 401)

  // 6e. Schema 校验补齐：必填请求头缺失 / Body 参数必填与类型
  const bodyApi = { id: 'smoke-body', name: 'Body校验测试', method: 'POST', path: '/api/v1/body-check', backendUrl: `${BASE}/upstream/echo`, groupId: null, status: 'draft', auth: 'none', qps: 100, timeout: 3000, retry: 0, circuitBreaker: { enabled: false }, headers: [{ name: 'X-Tenant', type: 'string', required: true, description: '租户标识' }], bodyParams: [{ name: 'count', type: 'number', required: true, description: '数量' }, { name: 'tags', type: 'array', required: false, description: '标签' }], createdAt: '2026-09-07', updatedAt: '2026-09-07' }
  await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify(bodyApi) }))
  await j(await fetch(`${BASE}/admin/apis/smoke-body/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'published' }) }))
  r = await j(await fetch(`${BASE}/gw/api/v1/body-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 1 }) }))
  ok('缺少必填请求头被拒(400)', r.status === 400 && r.body?.code === 40001, `status=${r.status} ${r.body?.message ?? ''}`)
  r = await j(await fetch(`${BASE}/gw/api/v1/body-check`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant': 't1' }, body: JSON.stringify({}) }))
  ok('缺少必填 Body 参数被拒(400)', r.status === 400 && r.body?.code === 40001)
  r = await j(await fetch(`${BASE}/gw/api/v1/body-check`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant': 't1' }, body: JSON.stringify({ count: 'abc' }) }))
  ok('Body 参数类型错误被拒(400)', r.status === 400 && r.body?.code === 40001)
  r = await j(await fetch(`${BASE}/gw/api/v1/body-check`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant': 't1' }, body: JSON.stringify({ count: 2, tags: ['a'] }) }))
  ok('合法 Header+Body 调用成功(200)', r.status === 200, `status=${r.status} ${r.body?.message ?? ''}`)

  // 6f. 流式透传：响应保留上游 Content-Type 且带网关延迟头
  const rRaw = await fetch(`${BASE}/gw/api/v1/param-check?n=42`)
  await rRaw.arrayBuffer()
  ok('流式响应头透传(Content-Type + X-Gateway-Latency)', (rRaw.headers.get('content-type') ?? '').includes('application/json') && rRaw.headers.get('x-gateway-latency') !== null)

  // 7. 创建应用并授权（密钥由服务端生成，不信任客户端提交值）
  const app = { id: 'smoke-app-1', name: '冒烟测试应用', owner: 'QA', accessKey: 'ak_client_supplied_bad', secretKey: 'sk_client_supplied_bad', status: 'active', apiIds: [api.id], createdAt: '2026-09-07' }
  r = await j(await fetch(`${BASE}/admin/apps`, { method: 'POST', headers: H, body: JSON.stringify(app) }))
  ok('创建应用并授权（服务端生成密钥）', r.status === 200 && r.body.accessKey?.startsWith('ak_') && r.body.secretKey?.startsWith('sk_') && r.body.accessKey !== 'ak_client_supplied_bad')
  const ak = r.body.accessKey, sk = r.body.secretKey
  const HK = { 'X-Access-Key': ak, 'X-Secret-Key': sk }

  // 7c. SK 哈希存储：状态接口不下发明文 SK，也不泄漏哈希
  r = await j(await fetch(`${BASE}/admin/state`, { headers: H }))
  const appInState = r.body?.apps?.find((a) => a.id === 'smoke-app-1')
  ok('SK 不明文下发/哈希不泄漏', !!appInState && appInState.secretKey !== sk && String(appInState.secretKey ?? '').includes('****') && !JSON.stringify(appInState).includes('secretKeyHash'))

  // 7b. 连通性测试 SSRF 防护：云元数据地址始终拦截
  r = await j(await fetch(`${BASE}/admin/test`, { method: 'POST', headers: H, body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data' }) }))
  ok('SSRF 防护：云元数据地址拦截(403)', r.status === 403)

  // 8. 网关真实调用（AccessKey + SecretKey 双因子）
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42?foo=bar`, { headers: HK }))
  ok('网关调用成功(200)', r.status === 200 && r.body?.data?.echo?.path?.includes('/upstream/echo/42'), `path=${r.body?.data?.echo?.path}`)

  // 9. 无密钥应 401；仅 AK 缺 SK 应 401；SK 错误应 401
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`))
  ok('无 AccessKey 拒绝(401)', r.status === 401)
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`, { headers: { 'X-Access-Key': ak } }))
  ok('缺少 SecretKey 拒绝(40102)', r.status === 401 && r.body?.code === 40102)
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`, { headers: { 'X-Access-Key': ak, 'X-Secret-Key': 'sk_wrong' } }))
  ok('错误 SecretKey 拒绝(40102)', r.status === 401 && r.body?.code === 40102)

  // 10. 未授权应用的密钥应 403
  r = await j(await fetch(`${BASE}/admin/apps`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'smoke-app-2', name: '未授权应用', owner: 'QA', status: 'active', apiIds: [], createdAt: '2026-09-07' }) }))
  const app2 = r.body
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`, { headers: { 'X-Access-Key': app2.accessKey, 'X-Secret-Key': app2.secretKey } }))
  ok('未授权应用拒绝(403)', r.status === 403)

  // 11. 错误方法应 405
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`, { method: 'POST', headers: HK }))
  ok('方法不匹配拒绝(405)', r.status === 405)

  // 12. 停用应用后调用应 401；启用中应用不允许重置 SK
  r = await j(await fetch(`${BASE}/admin/apps`, { method: 'POST', headers: H, body: JSON.stringify({ ...app, accessKey: ak, secretKey: sk, resetSecret: true }) }))
  ok('启用中应用重置 SK 被拒(409)', r.status === 409)
  await fetch(`${BASE}/admin/apps`, { method: 'POST', headers: H, body: JSON.stringify({ ...app, accessKey: ak, secretKey: sk, status: 'disabled' }) })
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`, { headers: HK }))
  ok('停用应用拒绝(401)', r.status === 401)

  // 12b. 停用后重置 SK 成功，旧 SK 失效、新 SK 可用
  r = await j(await fetch(`${BASE}/admin/apps`, { method: 'POST', headers: H, body: JSON.stringify({ ...app, accessKey: ak, secretKey: sk, status: 'disabled', resetSecret: true }) }))
  const newSk = r.body?.secretKey
  ok('停用后重置 SK 成功', r.status === 200 && newSk && newSk !== sk)
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`, { headers: HK }))
  ok('旧 SecretKey 立即失效(401)', r.status === 401)
  await fetch(`${BASE}/admin/apps`, { method: 'POST', headers: H, body: JSON.stringify({ ...app, accessKey: ak, secretKey: newSk, status: 'active' }) })
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`, { headers: { 'X-Access-Key': ak, 'X-Secret-Key': newSk } }))
  ok('新 SecretKey 调用成功(200)', r.status === 200)

  // 12c. QPS 告警：70 次突发调用（近 60 秒均值 ≈1.17/s），验证滑窗统计不被健康度 50 条截断压缩到 0.83 以下
  const qpsTag = Date.now().toString(36)
  const qpsRuleId = `smoke-rule-qps-${qpsTag}`
  await j(await fetch(`${BASE}/admin/rules`, { method: 'POST', headers: H, body: JSON.stringify({ id: qpsRuleId, name: `冒烟QPS告警-${qpsTag}`, metric: 'qps', threshold: 1, level: 'info', enabled: true, createdAt: '2026-09-07' }) }))
  for (let i = 0; i < 70; i += 10) {
    await Promise.all(Array.from({ length: 10 }, () => fetch(`${BASE}/gw/api/v1/param-check?n=42`)))
  }
  r = await j(await fetch(`${BASE}/admin/state`, { headers: H }))
  const qpsAlert = r.body?.alertRecords?.find((a) => a.ruleId === qpsRuleId)
  const qpsVal = Number(qpsAlert?.message?.match(/QPS ([\d.]+)/)?.[1] ?? 0)
  ok('QPS 告警触发且数值突破旧上限 0.83', !!qpsAlert && qpsVal > 0.83, qpsAlert?.message ?? '未产生告警')
  await fetch(`${BASE}/admin/rules/${qpsRuleId}`, { method: 'DELETE', headers: H }).catch(() => {})

  // 13. 调用日志已落库
  r = await j(await fetch(`${BASE}/admin/logs?apiId=${api.id}`, { headers: H }))
  ok('调用日志已记录', r.status === 200 && (r.body.total ?? r.body.list?.length ?? 0) >= 3, `total=${r.body.total}`)

  // 14. 操作审计已记录
  r = await j(await fetch(`${BASE}/admin/audit-logs?keyword=冒烟`, { headers: H }))
  ok('操作审计已记录', r.status === 200 && (r.body.total ?? 0) >= 2, `total=${r.body.total}`)

  // 15. 退出登录后令牌立即失效（持久化黑名单，重启亦不恢复）
  const s2 = await j(await fetch(`${BASE}/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD_USED }) }))
  const t2 = s2.body?.token
  ok('第二会话登录', !!t2)
  await j(await fetch(`${BASE}/admin/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${t2}` } }))
  r = await j(await fetch(`${BASE}/admin/state`, { headers: { Authorization: `Bearer ${t2}` } }))
  ok('注销后令牌立即失效(401)', r.status === 401)
} catch (err) {
  fail++
  console.error(`❌ 执行异常：${err?.message ?? err}`)
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
