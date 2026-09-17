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
  r = await j(await fetch(`${BASE}/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin@123' }) }))
  ok('管理员登录', r.status === 200 && !!r.body.token)
  if (!r.body?.token) throw new Error('登录失败，后续用例无法执行')
  const token = r.body.token
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  // 2b. 错误密码应拒绝
  r = await j(await fetch(`${BASE}/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' }) }))
  ok('错误密码被拒绝(401)', r.status === 401)

  // 2c. 清理上次运行残留的冒烟数据（v1.1 起已发布 API 禁止编辑，残留会导致重复运行失败）
  for (const appId of ['smoke-app-1', 'smoke-app-2']) {
    await fetch(`${BASE}/admin/apps/${appId}`, { method: 'DELETE', headers: H }).catch(() => {})
  }
  await fetch(`${BASE}/admin/apis/smoke-api-1/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'deprecated' }) }).catch(() => {})
  await fetch(`${BASE}/admin/apis/smoke-api-1`, { method: 'DELETE', headers: H }).catch(() => {})

  // 3. 注册新 API（草稿）
  const api = {
    id: 'smoke-api-1', name: '冒烟测试API', method: 'GET', path: '/api/v1/smoke/{id}',
    backendUrl: `${BASE}/upstream/echo/{id}`, groupId: null,
    status: 'draft', auth: 'apikey', qps: 100, timeout: 3000, retry: 1,
    circuitBreaker: { enabled: false }, createdAt: '2026-09-07', updatedAt: '2026-09-07',
  }
  r = await j(await fetch(`${BASE}/admin/apis`, { method: 'POST', headers: H, body: JSON.stringify(api) }))
  ok('注册 API（草稿）', r.status === 200 && r.body.id === api.id)

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

  // 7. 创建应用并授权
  const app = { id: 'smoke-app-1', name: '冒烟测试应用', owner: 'QA', accessKey: 'ak_smoke1234567890', secretKey: 'sk_smoke_secret_0000000000000001', status: 'active', apiIds: [api.id], createdAt: '2026-09-07' }
  r = await j(await fetch(`${BASE}/admin/apps`, { method: 'POST', headers: H, body: JSON.stringify(app) }))
  ok('创建应用并授权', r.status === 200)

  // 8. 网关真实调用（带 AccessKey）
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42?foo=bar`, { headers: { 'X-Access-Key': app.accessKey } }))
  ok('网关调用成功(200)', r.status === 200 && r.body?.data?.echo?.path?.includes('/upstream/echo/42'), `path=${r.body?.data?.echo?.path}`)

  // 9. 无 AccessKey 应 401
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`))
  ok('无 AccessKey 拒绝(401)', r.status === 401)

  // 10. 未授权应用的 AccessKey 应 403
  await fetch(`${BASE}/admin/apps`, { method: 'POST', headers: H, body: JSON.stringify({ ...app, id: 'smoke-app-2', name: '未授权应用', accessKey: 'ak_smoke_noauth_00000', apiIds: [] }) })
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`, { headers: { 'X-Access-Key': 'ak_smoke_noauth_00000' } }))
  ok('未授权应用拒绝(403)', r.status === 403)

  // 11. 错误方法应 405
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`, { method: 'POST', headers: { 'X-Access-Key': app.accessKey } }))
  ok('方法不匹配拒绝(405)', r.status === 405)

  // 12. 停用应用后调用应 401
  await fetch(`${BASE}/admin/apps`, { method: 'POST', headers: H, body: JSON.stringify({ ...app, status: 'disabled' }) })
  r = await j(await fetch(`${BASE}/gw/api/v1/smoke/42`, { headers: { 'X-Access-Key': app.accessKey } }))
  ok('停用应用拒绝(401)', r.status === 401)

  // 13. 调用日志已落库
  r = await j(await fetch(`${BASE}/admin/logs?apiId=${api.id}`, { headers: H }))
  ok('调用日志已记录', r.status === 200 && (r.body.total ?? r.body.list?.length ?? 0) >= 3, `total=${r.body.total}`)

  // 14. 操作审计已记录
  r = await j(await fetch(`${BASE}/admin/audit-logs?keyword=冒烟`, { headers: H }))
  ok('操作审计已记录', r.status === 200 && (r.body.total ?? 0) >= 2, `total=${r.body.total}`)
} catch (err) {
  fail++
  console.error(`❌ 执行异常：${err?.message ?? err}`)
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
