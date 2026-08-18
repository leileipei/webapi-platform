import type { ApiItem, ApiGroup, AppCredential, AlertRule, AlertRecord } from '@/types'
import { genMetrics, randomKey } from './metrics'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function seedGroups(): ApiGroup[] {
  return [
    { id: 'g-user', name: '用户中心', description: '用户注册、登录、资料等账户服务', createdAt: daysAgo(180) },
    { id: 'g-order', name: '交易订单', description: '下单、支付、退款、订单查询', createdAt: daysAgo(160) },
    { id: 'g-goods', name: '商品服务', description: '商品、库存、类目、搜索', createdAt: daysAgo(150) },
    { id: 'g-open', name: '开放平台', description: '对外开放的第三方接入接口', createdAt: daysAgo(90) },
  ]
}

function api(partial: Partial<ApiItem> & Pick<ApiItem, 'id' | 'name' | 'path' | 'method' | 'groupId' | 'baseCalls'>): ApiItem {
  return {
    protocol: 'HTTPS',
    version: 'v1.0.0',
    description: '',
    status: 'published',
    backendUrl: 'http://10.0.0.11:8080' + partial.path,
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
    health: 'healthy',
    versions: [{ version: partial.version ?? 'v1.0.0', date: daysAgo(120), note: '首次发布' }],
    ...partial,
  }
}

export function seedApis(): ApiItem[] {
  return [
    api({
      id: 'api-login', name: '用户登录', path: '/api/v1/auth/login', method: 'POST', groupId: 'g-user', baseCalls: 86000,
      description: '账号密码 / 短信验证码登录，返回访问令牌',
      bodyParams: [
        { name: 'username', type: 'string', required: true, description: '用户名或手机号' },
        { name: 'password', type: 'string', required: true, description: '密码（RSA 加密后传输）' },
        { name: 'captcha', type: 'string', required: false, description: '图形验证码，触发风控时必填' },
      ],
      responseExample: '{\n  "code": 0,\n  "message": "success",\n  "data": {\n    "token": "eyJhbGciOi...",\n    "expiresIn": 7200\n  }\n}',
      versions: [
        { version: 'v1.0.0', date: daysAgo(150), note: '首次发布' },
        { version: 'v1.1.0', date: daysAgo(30), note: '新增短信验证码登录' },
      ],
      version: 'v1.1.0',
    }),
    api({
      id: 'api-userinfo', name: '获取用户信息', path: '/api/v1/users/{id}', method: 'GET', groupId: 'g-user', baseCalls: 152000,
      description: '按用户 ID 查询用户基础资料',
      queryParams: [{ name: 'fields', type: 'string', required: false, description: '逗号分隔的字段列表' }],
      responseExample: '{\n  "code": 0,\n  "data": {\n    "id": "u_1001",\n    "nickname": "小明",\n    "avatar": "https://..."\n  }\n}',
    }),
    api({
      id: 'api-order-create', name: '创建订单', path: '/api/v1/orders', method: 'POST', groupId: 'g-order', baseCalls: 42000,
      description: '提交购物车生成待支付订单，支持幂等键防重复提交',
      headers: [
        { name: 'X-Access-Key', type: 'string', required: true, description: '应用访问密钥' },
        { name: 'Idempotency-Key', type: 'string', required: true, description: '幂等键，24h 内去重' },
      ],
      bodyParams: [
        { name: 'items', type: 'array', required: true, description: '商品条目 [{skuId, quantity}]' },
        { name: 'addressId', type: 'string', required: true, description: '收货地址 ID' },
        { name: 'couponId', type: 'string', required: false, description: '优惠券 ID' },
      ],
      responseExample: '{\n  "code": 0,\n  "data": {\n    "orderId": "SO20260801001",\n    "amount": 19900,\n    "status": "PENDING_PAYMENT"\n  }\n}',
      health: 'degraded',
      timeout: 5000,
      retry: 0,
      qps: 300,
    }),
    api({
      id: 'api-order-query', name: '订单列表查询', path: '/api/v1/orders', method: 'GET', groupId: 'g-order', baseCalls: 68000,
      queryParams: [
        { name: 'page', type: 'number', required: false, description: '页码，默认 1' },
        { name: 'pageSize', type: 'number', required: false, description: '每页条数，默认 20，最大 100' },
        { name: 'status', type: 'string', required: false, description: '订单状态筛选' },
      ],
      description: '分页查询当前用户的订单列表',
    }),
    api({
      id: 'api-pay-notify', name: '支付结果回调', path: '/api/v1/pay/notify', method: 'POST', groupId: 'g-order', baseCalls: 39000,
      auth: 'none',
      description: '支付渠道异步回调入口，验签后更新订单状态',
      health: 'healthy',
    }),
    api({
      id: 'api-goods-detail', name: '商品详情', path: '/api/v1/goods/{id}', method: 'GET', groupId: 'g-goods', baseCalls: 210000,
      description: '商品详情聚合接口（基础信息 + 实时库存 + 价格）',
      qps: 2000,
    }),
    api({
      id: 'api-goods-search', name: '商品搜索', path: '/api/v1/goods/search', method: 'GET', groupId: 'g-goods', baseCalls: 95000,
      queryParams: [
        { name: 'keyword', type: 'string', required: true, description: '搜索关键词' },
        { name: 'categoryId', type: 'string', required: false, description: '类目过滤' },
        { name: 'sort', type: 'string', required: false, description: '排序：price_asc / price_desc / sales' },
      ],
      health: 'healthy',
    }),
    api({
      id: 'api-stock-deduct', name: '库存扣减', path: '/api/v1/stock/deduct', method: 'POST', groupId: 'g-goods', baseCalls: 41000,
      description: '下单扣减库存，强一致性，失败自动回补',
      timeout: 2000,
      qps: 200,
      circuitBreaker: { enabled: true, errorRateThreshold: 30, windowSec: 20 },
    }),
    api({
      id: 'api-open-weather', name: '天气查询（开放）', path: '/open/v1/weather', method: 'GET', groupId: 'g-open', baseCalls: 12000,
      auth: 'apikey',
      status: 'published',
      queryParams: [{ name: 'city', type: 'string', required: true, description: '城市名称或编码' }],
      description: '开放平台示例接口：实时天气查询',
      createdAt: daysAgo(20),
    }),
    api({
      id: 'api-open-sms', name: '短信发送（开放）', path: '/open/v1/sms/send', method: 'POST', groupId: 'g-open', baseCalls: 5000,
      status: 'draft',
      description: '开放平台短信发送能力，灰度中',
      createdAt: daysAgo(5),
      updatedAt: daysAgo(1),
      health: 'unknown',
    }),
    api({
      id: 'api-legacy-sync', name: '老版数据同步', path: '/api/v0/sync', method: 'POST', groupId: 'g-user', baseCalls: 800,
      status: 'deprecated',
      protocol: 'HTTP',
      description: '旧系统数据同步接口，已被 /api/v1/users/import 替代，计划月底下线',
      health: 'down',
      createdAt: daysAgo(400),
      versions: [
        { version: 'v0.9.0', date: daysAgo(400), note: '首次发布' },
        { version: 'v0.9.1', date: daysAgo(200), note: '修复时区问题' },
      ],
      version: 'v0.9.1',
    }),
  ]
}

export function seedApps(apis: ApiItem[]): AppCredential[] {
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

export function seedAlertRules(): AlertRule[] {
  return [
    { id: 'rule-1', name: '错误率过高', metric: 'errorRate', threshold: 5, level: 'critical', enabled: true, createdAt: daysAgo(60) },
    { id: 'rule-2', name: '平均延迟超阈值', metric: 'latency', threshold: 500, level: 'warning', enabled: true, createdAt: daysAgo(60) },
    { id: 'rule-3', name: 'QPS 突增提醒', metric: 'qps', threshold: 3000, level: 'info', enabled: false, createdAt: daysAgo(45) },
  ]
}

export function seedAlertRecords(apis: ApiItem[]): AlertRecord[] {
  const order = apis.find((a) => a.id === 'api-order-create')!
  const m = genMetrics(order.id, order.baseCalls, 30)
  const worst = [...m].sort((a, b) => b.errors / Math.max(1, b.calls) - a.errors / Math.max(1, a.calls))[0]
  return [
    {
      id: 'alert-1', ruleId: 'rule-1', ruleName: '错误率过高', apiId: order.id, apiName: order.name,
      level: 'critical',
      message: `「${order.name}」在 ${worst.date} 错误率达 ${((worst.errors / Math.max(1, worst.calls)) * 100).toFixed(1)}%，超过阈值 5%`,
      time: worst.date + ' 14:23:07', acked: false,
    },
    {
      id: 'alert-2', ruleId: 'rule-2', ruleName: '平均延迟超阈值', apiId: order.id, apiName: order.name,
      level: 'warning',
      message: `「${order.name}」平均延迟 ${worst.avgLatency}ms，接近阈值 500ms`,
      time: daysAgo(2) + ' 09:41:52', acked: true,
    },
    {
      id: 'alert-3', ruleId: 'rule-1', ruleName: '错误率过高', apiId: 'api-legacy-sync', apiName: '老版数据同步',
      level: 'critical',
      message: '「老版数据同步」健康检查连续 3 次失败，服务不可达',
      time: daysAgo(1) + ' 03:12:40', acked: false,
    },
  ]
}
