// 内置示例数据 —— 首次启动时写入 SQLite
// 后端地址指向内置 mock 上游（/upstream/*），保证示例 API 可真实调通

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const UP = 'http://localhost:3100/upstream'

function api(partial) {
  return {
    protocol: 'HTTPS',
    version: 'v1.0.0',
    description: '',
    status: 'published',
    timeout: 3000,
    retry: 1,
    qps: 500,
    auth: 'apikey',
    circuitBreaker: { enabled: true, errorRateThreshold: 50, windowSec: 30 },
    queryParams: [],
    headers: [{ name: 'X-Access-Key', type: 'string', required: true, description: '应用访问密钥' }],
    bodyParams: [],
    responseExample: '{\n  "code": 0,\n  "message": "success",\n  "data": {}\n}',
    createdAt: daysAgo(120),
    updatedAt: daysAgo(3),
    baseCalls: 5000,
    versions: [{ version: partial.version ?? 'v1.0.0', date: daysAgo(120), note: '首次发布' }],
    ...partial,
  }
}

export function seedGroups() {
  return [
    { id: 'g-user', name: '用户中心', description: '用户注册、登录、资料等账户服务', createdAt: daysAgo(180) },
    { id: 'g-order', name: '交易订单', description: '下单、支付、退款、订单查询', createdAt: daysAgo(160) },
    { id: 'g-goods', name: '商品服务', description: '商品、库存、类目、搜索', createdAt: daysAgo(150) },
    { id: 'g-open', name: '开放平台', description: '对外开放的第三方接入接口', createdAt: daysAgo(90) },
  ]
}

export function seedApis() {
  return [
    api({
      id: 'api-login', name: '用户登录', path: '/api/v1/auth/login', method: 'POST', groupId: 'g-user', baseCalls: 86000,
      description: '账号密码 / 短信验证码登录，返回访问令牌',
      backendUrl: `${UP}/auth/login`,
      bodyParams: [
        { name: 'username', type: 'string', required: true, description: '用户名或手机号' },
        { name: 'password', type: 'string', required: true, description: '密码（RSA 加密后传输）' },
        { name: 'captcha', type: 'string', required: false, description: '图形验证码，触发风控时必填' },
      ],
      versions: [
        { version: 'v1.1.0', date: daysAgo(30), note: '新增短信验证码登录' },
        { version: 'v1.0.0', date: daysAgo(150), note: '首次发布' },
      ],
      version: 'v1.1.0',
    }),
    api({
      id: 'api-userinfo', name: '获取用户信息', path: '/api/v1/users/{id}', method: 'GET', groupId: 'g-user', baseCalls: 152000,
      description: '按用户 ID 查询用户基础资料',
      backendUrl: `${UP}/users/{id}`,
      queryParams: [{ name: 'fields', type: 'string', required: false, description: '逗号分隔的字段列表' }],
    }),
    api({
      id: 'api-order-create', name: '创建订单', path: '/api/v1/orders', method: 'POST', groupId: 'g-order', baseCalls: 42000,
      description: '提交购物车生成待支付订单，支持幂等键防重复提交',
      backendUrl: `${UP}/orders`,
      headers: [
        { name: 'X-Access-Key', type: 'string', required: true, description: '应用访问密钥' },
        { name: 'Idempotency-Key', type: 'string', required: true, description: '幂等键，24h 内去重' },
      ],
      bodyParams: [
        { name: 'items', type: 'array', required: true, description: '商品条目 [{skuId, quantity}]' },
        { name: 'addressId', type: 'string', required: true, description: '收货地址 ID' },
        { name: 'couponId', type: 'string', required: false, description: '优惠券 ID' },
      ],
      timeout: 5000, retry: 0, qps: 300,
    }),
    api({
      id: 'api-order-query', name: '订单列表查询', path: '/api/v1/orders', method: 'GET', groupId: 'g-order', baseCalls: 68000,
      description: '分页查询当前用户的订单列表',
      backendUrl: `${UP}/orders`,
      queryParams: [
        { name: 'page', type: 'number', required: false, description: '页码，默认 1' },
        { name: 'pageSize', type: 'number', required: false, description: '每页条数，默认 20，最大 100' },
        { name: 'status', type: 'string', required: false, description: '订单状态筛选' },
      ],
    }),
    api({
      id: 'api-pay-notify', name: '支付结果回调', path: '/api/v1/pay/notify', method: 'POST', groupId: 'g-order', baseCalls: 39000,
      auth: 'none',
      description: '支付渠道异步回调入口，验签后更新订单状态',
      backendUrl: `${UP}/pay/notify`,
    }),
    api({
      id: 'api-goods-detail', name: '商品详情', path: '/api/v1/goods/{id}', method: 'GET', groupId: 'g-goods', baseCalls: 210000,
      description: '商品详情聚合接口（基础信息 + 实时库存 + 价格）',
      backendUrl: `${UP}/goods/{id}`,
      qps: 2000,
    }),
    api({
      id: 'api-goods-search', name: '商品搜索', path: '/api/v1/goods/search', method: 'GET', groupId: 'g-goods', baseCalls: 95000,
      description: '商品关键词搜索，支持类目过滤与排序',
      backendUrl: `${UP}/goods/search`,
      queryParams: [
        { name: 'keyword', type: 'string', required: true, description: '搜索关键词' },
        { name: 'categoryId', type: 'string', required: false, description: '类目过滤' },
        { name: 'sort', type: 'string', required: false, description: '排序：price_asc / price_desc / sales' },
      ],
    }),
    api({
      id: 'api-stock-deduct', name: '库存扣减', path: '/api/v1/stock/deduct', method: 'POST', groupId: 'g-goods', baseCalls: 41000,
      description: '下单扣减库存，强一致性，失败自动回补',
      backendUrl: `${UP}/stock/deduct`,
      timeout: 2000, qps: 200,
      circuitBreaker: { enabled: true, errorRateThreshold: 30, windowSec: 20 },
    }),
    api({
      id: 'api-open-weather', name: '天气查询（开放）', path: '/open/v1/weather', method: 'GET', groupId: 'g-open', baseCalls: 12000,
      description: '开放平台示例接口：实时天气查询',
      backendUrl: `${UP}/weather`,
      queryParams: [{ name: 'city', type: 'string', required: true, description: '城市名称或编码' }],
      createdAt: daysAgo(20),
    }),
    api({
      id: 'api-open-sms', name: '短信发送（开放）', path: '/open/v1/sms/send', method: 'POST', groupId: 'g-open', baseCalls: 5000,
      status: 'draft',
      description: '开放平台短信发送能力，灰度中',
      backendUrl: `${UP}/sms/send`,
      createdAt: daysAgo(5), updatedAt: daysAgo(1),
    }),
    api({
      id: 'api-legacy-sync', name: '老版数据同步', path: '/api/v0/sync', method: 'POST', groupId: 'g-user', baseCalls: 800,
      status: 'deprecated', protocol: 'HTTP',
      description: '旧系统数据同步接口，已被 /api/v1/users/import 替代，计划月底下线',
      backendUrl: 'http://192.0.2.10:9000/sync', // 不可达地址，演示熔断与失败告警
      createdAt: daysAgo(400),
      versions: [
        { version: 'v0.9.1', date: daysAgo(200), note: '修复时区问题' },
        { version: 'v0.9.0', date: daysAgo(400), note: '首次发布' },
      ],
      version: 'v0.9.1',
    }),
  ]
}

function randomKey(prefix, len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `${prefix}_${s}`
}

export function seedApps(apis) {
  const published = apis.filter((a) => a.status === 'published')
  return [
    {
      id: 'app-mall', name: '商城 App', owner: '前端一组', accessKey: randomKey('ak', 16), secretKey: randomKey('sk', 32),
      status: 'active', apiIds: published.map((a) => a.id), createdAt: daysAgo(100),
    },
    {
      id: 'app-wx', name: '微信小程序', owner: '增长团队', accessKey: randomKey('ak', 16), secretKey: randomKey('sk', 32),
      status: 'active', apiIds: published.slice(0, 6).map((a) => a.id), createdAt: daysAgo(80),
    },
    {
      id: 'app-partner', name: '第三方合作伙伴-云仓', owner: '开放平台部', accessKey: randomKey('ak', 16), secretKey: randomKey('sk', 32),
      status: 'disabled', apiIds: ['api-open-weather'], createdAt: daysAgo(30),
    },
  ]
}

export function seedRules() {
  return [
    { id: 'rule-1', name: '错误率过高', metric: 'errorRate', threshold: 5, level: 'critical', enabled: true, createdAt: daysAgo(60) },
    { id: 'rule-2', name: '平均延迟超阈值', metric: 'latency', threshold: 500, level: 'warning', enabled: true, createdAt: daysAgo(60) },
    { id: 'rule-3', name: 'QPS 突增提醒', metric: 'qps', threshold: 3000, level: 'info', enabled: false, createdAt: daysAgo(45) },
  ]
}

export function seedAlerts() {
  const tsDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().replace('T', ' ').slice(0, 19)
  return [
    {
      id: 'alert-1', ruleId: 'rule-1', ruleName: '错误率过高', apiId: 'api-order-create', apiName: '创建订单',
      level: 'critical',
      message: '「创建订单」历史错误率曾达 7.2%，超过阈值 5%（示例数据）',
      time: tsDaysAgo(6), acked: 0,
    },
    {
      id: 'alert-2', ruleId: 'rule-2', ruleName: '平均延迟超阈值', apiId: 'api-order-create', apiName: '创建订单',
      level: 'warning',
      message: '「创建订单」平均延迟 386ms，接近阈值 500ms（示例数据）',
      time: tsDaysAgo(2), acked: 1,
    },
  ]
}

/** 确定性伪随机，用于生成 30 天历史指标 */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function seedMetricsRows(apis) {
  const rows = []
  for (const a of apis) {
    if (a.status !== 'published') continue
    const rnd = mulberry32(hashCode(a.id))
    for (let i = 29; i >= 1; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const weekendFactor = d.getDay() === 0 || d.getDay() === 6 ? 0.55 : 1
      const growth = 1 + (29 - i) * 0.008
      const noise = 0.75 + rnd() * 0.5
      const calls = Math.round(a.baseCalls * weekendFactor * growth * noise)
      const errorRate = rnd() < 0.08 ? 0.03 + rnd() * 0.1 : rnd() * 0.015
      const errors = Math.round(calls * errorRate)
      const avgLatency = Math.round(20 + rnd() * 60 + (errorRate > 0.03 ? rnd() * 300 : 0))
      rows.push({ apiId: a.id, date: d.toISOString().slice(0, 10), calls, errors, latencySum: avgLatency * calls })
    }
  }
  return rows
}
