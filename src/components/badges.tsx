import type { ApiStatus, HealthStatus, HttpMethod } from '@/types'
import { cn } from '@/lib/utils'

export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  POST: 'bg-blue-100 text-blue-700 border-blue-200',
  PUT: 'bg-amber-100 text-amber-700 border-amber-200',
  DELETE: 'bg-red-100 text-red-700 border-red-200',
  PATCH: 'bg-violet-100 text-violet-700 border-violet-200',
}

export function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span className={cn('inline-block w-16 rounded border px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold', METHOD_COLORS[method])}>
      {method}
    </span>
  )
}

export const STATUS_META: Record<ApiStatus, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  published: { label: '已发布', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  offline: { label: '已下线', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  deprecated: { label: '已废弃', className: 'bg-red-100 text-red-600 border-red-200' },
}

export function StatusBadge({ status }: { status: ApiStatus }) {
  const meta = STATUS_META[status]
  return <span className={cn('inline-block rounded-full border px-2 py-0.5 text-xs font-medium', meta.className)}>{meta.label}</span>
}

export const HEALTH_META: Record<HealthStatus, { label: string; dot: string; text: string }> = {
  healthy: { label: '健康', dot: 'bg-emerald-500', text: 'text-emerald-600' },
  degraded: { label: '性能下降', dot: 'bg-amber-500', text: 'text-amber-600' },
  down: { label: '不可用', dot: 'bg-red-500', text: 'text-red-600' },
  unknown: { label: '未知', dot: 'bg-slate-400', text: 'text-slate-500' },
}

export function HealthDot({ health }: { health: HealthStatus }) {
  const meta = HEALTH_META[health]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', meta.text)}>
      <span className={cn('h-2 w-2 rounded-full', meta.dot, health === 'healthy' && 'animate-pulse')} />
      {meta.label}
    </span>
  )
}

export const AUTH_LABELS: Record<string, string> = {
  none: '无鉴权',
  apikey: 'API Key',
  oauth2: 'OAuth 2.0',
  jwt: 'JWT',
}
