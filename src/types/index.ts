export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
export type ApiStatus = 'draft' | 'published' | 'offline' | 'deprecated'
export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown'
export type AuthType = 'none' | 'apikey' | 'oauth2' | 'jwt'
export type Protocol = 'HTTP' | 'HTTPS' | 'WebSocket'

export interface ParamDoc {
  name: string
  type: string
  required: boolean
  description: string
}

export interface VersionRecord {
  version: string
  date: string
  note: string
}

export interface CircuitBreakerConfig {
  enabled: boolean
  errorRateThreshold: number // 百分比
  windowSec: number
}

export interface ApiItem {
  id: string
  name: string
  path: string
  method: HttpMethod
  protocol: Protocol
  groupId: string
  version: string
  description: string
  status: ApiStatus
  backendUrl: string
  timeout: number // ms
  retry: number
  qps: number // 限流
  auth: AuthType
  circuitBreaker: CircuitBreakerConfig
  queryParams: ParamDoc[]
  headers: ParamDoc[]
  bodyParams: ParamDoc[]
  responseExample: string
  createdAt: string
  updatedAt: string
  health: HealthStatus
  baseCalls: number
  versions: VersionRecord[]
  /** 后端注入：今日调用量 */
  todayCalls?: number
  /** 后端注入：近 30 天调用量 */
  calls30d?: number
}

export interface ApiGroup {
  id: string
  name: string
  description: string
  createdAt: string
}

export interface AppCredential {
  id: string
  name: string
  owner: string
  accessKey: string
  secretKey: string
  status: 'active' | 'disabled'
  apiIds: string[]
  createdAt: string
}

export type AlertMetric = 'errorRate' | 'latency' | 'qps'
export type AlertLevel = 'critical' | 'warning' | 'info'

export interface AlertRule {
  id: string
  name: string
  metric: AlertMetric
  threshold: number
  level: AlertLevel
  enabled: boolean
  createdAt: string
}

export interface AlertRecord {
  id: string
  ruleId: string
  ruleName: string
  apiId: string
  apiName: string
  level: AlertLevel
  message: string
  time: string
  acked: number
}

export interface MetricPoint {
  date: string
  calls: number
  errors: number
  avgLatency: number
}

export interface ApiLog {
  id: number
  ts: string
  api_id: string | null
  api_name: string | null
  app_name: string | null
  method: string
  path: string
  status: number
  latency: number
  ip: string | null
  message: string | null
}

export interface LogPage {
  total: number
  page: number
  pageSize: number
  items: ApiLog[]
}
